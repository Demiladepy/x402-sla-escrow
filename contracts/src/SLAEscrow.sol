// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SLAEscrow
 * @notice Pay-per-call escrow for x402 where payment is conditional on the
 *         response actually meeting the endpoint's advertised SLA.
 *
 * @dev The problem this solves: vanilla x402 asks each side to trust the other.
 *      The buyer pays and hopes a real response comes back; the seller serves and
 *      hopes the payment lands. For agents spending money unattended, that is the
 *      whole ballgame.
 *
 *      Design constraints that shaped this:
 *
 *      1. A buyer must never send a transaction to make a call. Sub-cent API calls
 *         cannot each carry an on-chain write. So the buyer deposits once, then
 *         signs an off-chain PaymentAuth per call (carried in the X-PAYMENT
 *         header, exactly the x402 shape). Settlement is the seller's job and can
 *         be batched.
 *
 *      2. A seller must not be payable without evidence of service. Every
 *         redemption carries a ServiceReceipt the seller signed. The contract
 *         enforces the objective half of the SLA itself: HTTP status must equal
 *         the advertised status, and servedAt - requestedAt must be within the
 *         advertised latency. Miss either and the redemption reverts. The buyer
 *         keeps the money without lifting a finger.
 *
 *      3. Receipts are self-signed, so a seller could forge one. Two paths make
 *         that irrational:
 *
 *         - Fast path (redeemWithAck): the buyer counter-signs the receipt it
 *           actually received. Both sides agree, funds move instantly, no window.
 *           This is the cooperative case and costs one extra signature.
 *
 *         - Unilateral path (redeem): no buyer ack, because the buyer is offline
 *           or is griefing by withholding it. The seller can still redeem, but the
 *           funds sit in a challenge window and the seller's bond is exposed.
 *           Forging a receipt to steal one call's revenue risks a bond worth
 *           MIN_BOND_MULTIPLE times that revenue. Expected value is deeply
 *           negative, so honest sellers redeem unilaterally and forgers do not.
 *
 *      4. Whether a response body matched the advertised schema is not objectively
 *         checkable on-chain. That half is optimistic: the buyer may challenge
 *         within the window by posting its own bond, and an arbiter resolves. The
 *         loser's stake pays the winner, so neither spurious challenges nor
 *         garbage responses are free.
 *
 *      Net claim: latency and status are trustlessly enforced, body correctness is
 *      bonded, and the buyer's per-call gas cost is zero.
 */
contract SLAEscrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Config
    // ---------------------------------------------------------------------

    /// @notice Settlement asset. cUSD on Celo.
    IERC20 public immutable token;

    /// @notice Resolves challenges. v1 is a single key; the README describes the
    ///         committee path this is designed to grow into.
    address public arbiter;

    /// @notice A seller's bond must cover at least this many calls at its own
    ///         advertised price. Sets the floor on how unprofitable forgery is.
    uint256 public constant MIN_BOND_MULTIPLE = 100;

    /// @notice Buyer's stake to open a challenge, in multiples of the call price.
    uint256 public constant CHALLENGE_BOND_MULTIPLE = 10;

    /// @notice Slashed from the seller's bond when it loses a challenge.
    uint256 public constant SLASH_MULTIPLE = 50;

    /// @notice Bounds on the challenge window a seller may advertise.
    uint64 public constant MIN_CHALLENGE_WINDOW = 5 minutes;
    uint64 public constant MAX_CHALLENGE_WINDOW = 7 days;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum ClaimState {
        None,
        Pending,
        Challenged,
        Settled,
        Refunded
    }

    struct Endpoint {
        address seller;
        uint128 price;
        uint32 maxLatencyMs;
        uint16 expectedStatus;
        bytes32 schemaHash;
        uint64 challengeWindow;
        bool active;
    }

    /// @dev Signed by the buyer, off-chain, once per call. Never touches the chain
    ///      until the seller settles.
    struct PaymentAuth {
        address buyer;
        bytes32 endpointId;
        bytes32 requestId;
        uint128 amount;
        uint64 requestedAtMs;
        uint64 deadline;
    }

    /// @dev Signed by the seller when it serves the response.
    struct ServiceReceipt {
        bytes32 requestId;
        uint16 statusCode;
        uint64 servedAtMs;
        bytes32 bodyHash;
    }

    struct PendingClaim {
        bytes32 endpointId;
        address buyer;
        uint128 amount;
        uint128 challengeBond;
        uint64 claimableAt;
        ClaimState state;
    }

    bytes32 private constant PAYMENT_AUTH_TYPEHASH = keccak256(
        "PaymentAuth(address buyer,bytes32 endpointId,bytes32 requestId,uint128 amount,uint64 requestedAtMs,uint64 deadline)"
    );

    bytes32 private constant SERVICE_RECEIPT_TYPEHASH = keccak256(
        "ServiceReceipt(bytes32 requestId,uint16 statusCode,uint64 servedAtMs,bytes32 bodyHash)"
    );

    bytes32 private constant RECEIPT_ACK_TYPEHASH =
        keccak256("ReceiptAck(bytes32 requestId,bytes32 bodyHash)");

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    mapping(bytes32 => Endpoint) public endpoints;
    mapping(bytes32 => uint256) public bondOf;
    mapping(bytes32 => uint256) public lockedBondOf;
    mapping(address => uint256) public buyerBalance;
    mapping(address => uint256) public sellerBalance;
    mapping(bytes32 => PendingClaim) public claims;
    mapping(bytes32 => bool) public consumed;
    mapping(address => uint256) public endpointNonce;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event EndpointRegistered(
        bytes32 indexed endpointId,
        address indexed seller,
        uint128 price,
        uint32 maxLatencyMs,
        uint16 expectedStatus,
        bytes32 schemaHash,
        uint64 challengeWindow
    );
    event EndpointActiveSet(bytes32 indexed endpointId, bool active);
    event BondToppedUp(bytes32 indexed endpointId, uint256 amount, uint256 total);
    event BondWithdrawn(bytes32 indexed endpointId, uint256 amount, uint256 total);
    event Deposited(address indexed buyer, uint256 amount, uint256 balance);
    event BuyerWithdrew(address indexed buyer, uint256 amount, uint256 balance);
    event SellerWithdrew(address indexed seller, uint256 amount, uint256 balance);
    event Settled(
        bytes32 indexed requestId,
        bytes32 indexed endpointId,
        address indexed buyer,
        uint128 amount,
        uint32 latencyMs,
        bool fastPath
    );
    event RedemptionPending(
        bytes32 indexed requestId,
        bytes32 indexed endpointId,
        address indexed buyer,
        uint128 amount,
        uint64 claimableAt
    );
    event Challenged(bytes32 indexed requestId, address indexed challenger, uint128 bond);
    event Resolved(bytes32 indexed requestId, bool buyerWon, uint256 slashed);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotArbiter();
    error NotSeller();
    error EndpointInactive();
    error UnknownEndpoint();
    error BondTooSmall();
    error BondLocked();
    error AuthExpired();
    error AmountMismatch();
    error RequestAlreadyConsumed();
    error BadAuthSignature();
    error BadReceiptSignature();
    error BadAckSignature();
    error RequestIdMismatch();
    error StatusMismatch(uint16 expected, uint16 got);
    error LatencyExceeded(uint32 allowedMs, uint256 actualMs);
    error ClockSkew();
    error InsufficientBuyerBalance();
    error InsufficientBalance();
    error NotPending();
    error WindowNotElapsed();
    error WindowElapsed();
    error NotChallenged();
    error NotBuyer();
    error BadWindow();
    error ZeroPrice();
    error PriceOutOfRange();

    // ---------------------------------------------------------------------

    constructor(IERC20 _token, address _arbiter) EIP712("SLAEscrow", "1") {
        token = _token;
        arbiter = _arbiter;
    }

    modifier onlyArbiter() {
        if (msg.sender != arbiter) revert NotArbiter();
        _;
    }

    // ---------------------------------------------------------------------
    // Endpoint lifecycle
    // ---------------------------------------------------------------------

    /**
     * @notice Advertise an endpoint and its SLA, backed by a bond.
     * @param schemaHash keccak256 of the JSON Schema the response body must satisfy.
     *        Not enforced on-chain; it is what a challenge is adjudicated against.
     */
    function registerEndpoint(
        uint128 price,
        uint32 maxLatencyMs,
        uint16 expectedStatus,
        bytes32 schemaHash,
        uint64 challengeWindow,
        uint256 bondAmount
    ) external nonReentrant returns (bytes32 endpointId) {
        if (price == 0) revert ZeroPrice();
        // Bounding price here makes every downstream `price * MULTIPLE` (max 100x)
        // provably fit in uint128, so the casts below cannot truncate.
        if (uint256(price) > type(uint128).max / MIN_BOND_MULTIPLE) revert PriceOutOfRange();
        if (challengeWindow < MIN_CHALLENGE_WINDOW || challengeWindow > MAX_CHALLENGE_WINDOW) {
            revert BadWindow();
        }
        if (bondAmount < uint256(price) * MIN_BOND_MULTIPLE) revert BondTooSmall();

        endpointId = keccak256(abi.encode(msg.sender, endpointNonce[msg.sender]++, block.chainid));

        endpoints[endpointId] = Endpoint({
            seller: msg.sender,
            price: price,
            maxLatencyMs: maxLatencyMs,
            expectedStatus: expectedStatus,
            schemaHash: schemaHash,
            challengeWindow: challengeWindow,
            active: true
        });

        token.safeTransferFrom(msg.sender, address(this), bondAmount);
        bondOf[endpointId] = bondAmount;

        emit EndpointRegistered(
            endpointId, msg.sender, price, maxLatencyMs, expectedStatus, schemaHash, challengeWindow
        );
        emit BondToppedUp(endpointId, bondAmount, bondAmount);
    }

    function setEndpointActive(bytes32 endpointId, bool active) external {
        Endpoint storage e = endpoints[endpointId];
        if (e.seller == address(0)) revert UnknownEndpoint();
        if (e.seller != msg.sender) revert NotSeller();
        e.active = active;
        emit EndpointActiveSet(endpointId, active);
    }

    function topUpBond(bytes32 endpointId, uint256 amount) external nonReentrant {
        Endpoint storage e = endpoints[endpointId];
        if (e.seller == address(0)) revert UnknownEndpoint();
        token.safeTransferFrom(msg.sender, address(this), amount);
        bondOf[endpointId] += amount;
        emit BondToppedUp(endpointId, amount, bondOf[endpointId]);
    }

    /**
     * @notice Pull bond back down. Bond backing in-flight challenges is locked, and
     *         an endpoint that is still active must keep its full floor so it
     *         cannot advertise an SLA it can no longer back.
     */
    function withdrawBond(bytes32 endpointId, uint256 amount) external nonReentrant {
        Endpoint storage e = endpoints[endpointId];
        if (e.seller == address(0)) revert UnknownEndpoint();
        if (e.seller != msg.sender) revert NotSeller();

        uint256 free = bondOf[endpointId] - lockedBondOf[endpointId];
        if (amount > free) revert BondLocked();

        uint256 remaining = bondOf[endpointId] - amount;
        if (e.active && remaining < uint256(e.price) * MIN_BOND_MULTIPLE) revert BondTooSmall();

        bondOf[endpointId] = remaining;
        token.safeTransfer(msg.sender, amount);
        emit BondWithdrawn(endpointId, amount, remaining);
    }

    // ---------------------------------------------------------------------
    // Balances
    // ---------------------------------------------------------------------

    function deposit(uint256 amount) external nonReentrant {
        token.safeTransferFrom(msg.sender, address(this), amount);
        buyerBalance[msg.sender] += amount;
        emit Deposited(msg.sender, amount, buyerBalance[msg.sender]);
    }

    function withdrawBuyer(uint256 amount) external nonReentrant {
        if (buyerBalance[msg.sender] < amount) revert InsufficientBalance();
        buyerBalance[msg.sender] -= amount;
        token.safeTransfer(msg.sender, amount);
        emit BuyerWithdrew(msg.sender, amount, buyerBalance[msg.sender]);
    }

    function withdrawSeller(uint256 amount) external nonReentrant {
        if (sellerBalance[msg.sender] < amount) revert InsufficientBalance();
        sellerBalance[msg.sender] -= amount;
        token.safeTransfer(msg.sender, amount);
        emit SellerWithdrew(msg.sender, amount, sellerBalance[msg.sender]);
    }

    // ---------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------

    /**
     * @notice Fast path. The buyer counter-signed the receipt, so both sides agree
     *         on what was delivered and funds move immediately with no window.
     */
    function redeemWithAck(
        PaymentAuth calldata auth,
        bytes calldata authSig,
        ServiceReceipt calldata receipt,
        bytes calldata receiptSig,
        bytes calldata ackSig
    ) public nonReentrant {
        Endpoint storage e = _verify(auth, authSig, receipt, receiptSig);

        bytes32 ackDigest = _hashTypedDataV4(
            keccak256(abi.encode(RECEIPT_ACK_TYPEHASH, receipt.requestId, receipt.bodyHash))
        );
        if (ECDSA.recover(ackDigest, ackSig) != auth.buyer) revert BadAckSignature();

        consumed[auth.requestId] = true;
        _debitBuyer(auth.buyer, auth.amount);
        sellerBalance[e.seller] += auth.amount;

        claims[auth.requestId] = PendingClaim({
            endpointId: auth.endpointId,
            buyer: auth.buyer,
            amount: auth.amount,
            challengeBond: 0,
            claimableAt: uint64(block.timestamp),
            state: ClaimState.Settled
        });

        // Safe: _verify already reverted unless the gap is <= e.maxLatencyMs,
        // which is itself a uint32.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint32 latencyMs = uint32(receipt.servedAtMs - auth.requestedAtMs);
        emit Settled(auth.requestId, auth.endpointId, auth.buyer, auth.amount, latencyMs, true);
    }

    /**
     * @notice Unilateral path, for when the buyer never acked. Funds are held for
     *         the endpoint's challenge window with the seller's bond exposed.
     */
    function redeem(
        PaymentAuth calldata auth,
        bytes calldata authSig,
        ServiceReceipt calldata receipt,
        bytes calldata receiptSig
    ) external nonReentrant {
        Endpoint storage e = _verify(auth, authSig, receipt, receiptSig);

        uint256 slashReserve = uint256(e.price) * SLASH_MULTIPLE;
        if (bondOf[auth.endpointId] - lockedBondOf[auth.endpointId] < slashReserve) {
            revert BondTooSmall();
        }
        lockedBondOf[auth.endpointId] += slashReserve;

        consumed[auth.requestId] = true;
        _debitBuyer(auth.buyer, auth.amount);

        uint64 claimableAt = uint64(block.timestamp) + e.challengeWindow;
        claims[auth.requestId] = PendingClaim({
            endpointId: auth.endpointId,
            buyer: auth.buyer,
            amount: auth.amount,
            challengeBond: 0,
            claimableAt: claimableAt,
            state: ClaimState.Pending
        });

        emit RedemptionPending(auth.requestId, auth.endpointId, auth.buyer, auth.amount, claimableAt);
    }

    /// @notice Seller pulls a pending redemption once its window closes unchallenged.
    function claim(bytes32 requestId) external nonReentrant {
        PendingClaim storage c = claims[requestId];
        if (c.state != ClaimState.Pending) revert NotPending();
        if (block.timestamp < c.claimableAt) revert WindowNotElapsed();

        Endpoint storage e = endpoints[c.endpointId];
        c.state = ClaimState.Settled;
        lockedBondOf[c.endpointId] -= uint256(e.price) * SLASH_MULTIPLE;
        sellerBalance[e.seller] += c.amount;

        emit Settled(requestId, c.endpointId, c.buyer, c.amount, 0, false);
    }

    /**
     * @notice Buyer disputes that the body satisfied the advertised schema. Costs
     *         the buyer a bond, so spurious challenges are not free.
     */
    function challenge(bytes32 requestId) external nonReentrant {
        PendingClaim storage c = claims[requestId];
        if (c.state != ClaimState.Pending) revert NotPending();
        if (block.timestamp >= c.claimableAt) revert WindowElapsed();
        if (msg.sender != c.buyer) revert NotBuyer();

        Endpoint storage e = endpoints[c.endpointId];
        // Safe: registerEndpoint bounds price to uint128.max / MIN_BOND_MULTIPLE,
        // and CHALLENGE_BOND_MULTIPLE (10) < MIN_BOND_MULTIPLE (100).
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 bond = uint128(uint256(e.price) * CHALLENGE_BOND_MULTIPLE);
        if (buyerBalance[msg.sender] < bond) revert InsufficientBuyerBalance();

        buyerBalance[msg.sender] -= bond;
        c.challengeBond = bond;
        c.state = ClaimState.Challenged;

        emit Challenged(requestId, msg.sender, bond);
    }

    /**
     * @notice Arbiter decides a challenge. The loser's stake pays the winner: a
     *         seller that shipped garbage is slashed, a buyer that cried wolf
     *         forfeits its bond.
     */
    function resolve(bytes32 requestId, bool buyerWon) external onlyArbiter nonReentrant {
        PendingClaim storage c = claims[requestId];
        if (c.state != ClaimState.Challenged) revert NotChallenged();

        Endpoint storage e = endpoints[c.endpointId];
        uint256 slashReserve = uint256(e.price) * SLASH_MULTIPLE;
        lockedBondOf[c.endpointId] -= slashReserve;

        uint256 slashed = 0;
        if (buyerWon) {
            slashed = slashReserve;
            bondOf[c.endpointId] -= slashed;
            // Refund the call, return the challenge bond, and pay damages.
            buyerBalance[c.buyer] += uint256(c.amount) + c.challengeBond + slashed;
            c.state = ClaimState.Refunded;
        } else {
            sellerBalance[e.seller] += uint256(c.amount) + c.challengeBond;
            c.state = ClaimState.Settled;
        }

        emit Resolved(requestId, buyerWon, slashed);
    }

    // ---------------------------------------------------------------------
    // Batching
    // ---------------------------------------------------------------------

    /// @notice Settle many acked calls in one transaction. This is why per-call
    ///         on-chain cost is amortised rather than paid per request.
    function batchRedeemWithAck(
        PaymentAuth[] calldata auths,
        bytes[] calldata authSigs,
        ServiceReceipt[] calldata receipts,
        bytes[] calldata receiptSigs,
        bytes[] calldata ackSigs
    ) external {
        uint256 n = auths.length;
        for (uint256 i = 0; i < n; ++i) {
            redeemWithAck(auths[i], authSigs[i], receipts[i], receiptSigs[i], ackSigs[i]);
        }
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /**
     * @dev The heart of it. Everything objective about the SLA is checked here, and
     *      both settlement paths must pass through it.
     */
    function _verify(
        PaymentAuth calldata auth,
        bytes calldata authSig,
        ServiceReceipt calldata receipt,
        bytes calldata receiptSig
    ) internal view returns (Endpoint storage e) {
        e = endpoints[auth.endpointId];
        if (e.seller == address(0)) revert UnknownEndpoint();
        if (!e.active) revert EndpointInactive();
        if (consumed[auth.requestId]) revert RequestAlreadyConsumed();
        if (block.timestamp > auth.deadline) revert AuthExpired();
        if (auth.amount != e.price) revert AmountMismatch();
        if (receipt.requestId != auth.requestId) revert RequestIdMismatch();

        bytes32 authDigest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PAYMENT_AUTH_TYPEHASH,
                    auth.buyer,
                    auth.endpointId,
                    auth.requestId,
                    auth.amount,
                    auth.requestedAtMs,
                    auth.deadline
                )
            )
        );
        if (ECDSA.recover(authDigest, authSig) != auth.buyer) revert BadAuthSignature();

        bytes32 receiptDigest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SERVICE_RECEIPT_TYPEHASH,
                    receipt.requestId,
                    receipt.statusCode,
                    receipt.servedAtMs,
                    receipt.bodyHash
                )
            )
        );
        if (ECDSA.recover(receiptDigest, receiptSig) != e.seller) revert BadReceiptSignature();

        // Objective SLA term 1: the response carried the advertised status.
        if (receipt.statusCode != e.expectedStatus) {
            revert StatusMismatch(e.expectedStatus, receipt.statusCode);
        }

        // Objective SLA term 2: it arrived inside the advertised latency budget.
        if (receipt.servedAtMs < auth.requestedAtMs) revert ClockSkew();
        uint256 latency = receipt.servedAtMs - auth.requestedAtMs;
        if (latency > e.maxLatencyMs) revert LatencyExceeded(e.maxLatencyMs, latency);
    }

    function _debitBuyer(address buyer, uint128 amount) internal {
        if (buyerBalance[buyer] < amount) revert InsufficientBuyerBalance();
        buyerBalance[buyer] -= amount;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function hashPaymentAuth(PaymentAuth calldata auth) external view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PAYMENT_AUTH_TYPEHASH,
                    auth.buyer,
                    auth.endpointId,
                    auth.requestId,
                    auth.amount,
                    auth.requestedAtMs,
                    auth.deadline
                )
            )
        );
    }

    function hashServiceReceipt(ServiceReceipt calldata receipt) external view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SERVICE_RECEIPT_TYPEHASH,
                    receipt.requestId,
                    receipt.statusCode,
                    receipt.servedAtMs,
                    receipt.bodyHash
                )
            )
        );
    }

    function hashReceiptAck(bytes32 requestId, bytes32 bodyHash) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(RECEIPT_ACK_TYPEHASH, requestId, bodyHash)));
    }

    function availableBond(bytes32 endpointId) external view returns (uint256) {
        return bondOf[endpointId] - lockedBondOf[endpointId];
    }
}
