// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SLAEscrow} from "../src/SLAEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "./MockERC20.sol";

contract SLAEscrowTest is Test {
    SLAEscrow escrow;
    MockERC20 cusd;

    uint256 constant BUYER_PK = 0xB0B;
    uint256 constant SELLER_PK = 0x5E11E4;
    address buyer;
    address seller;
    address arbiter = address(0xA2B17E4);
    address stranger = address(0x57A);

    bytes32 endpointId;

    uint128 constant PRICE = 0.001e18;
    uint32 constant MAX_LATENCY_MS = 2000;
    uint16 constant STATUS_OK = 200;
    uint64 constant WINDOW = 1 hours;
    uint256 constant BOND = uint256(PRICE) * 200;
    uint256 constant DEPOSIT = 1e18;
    uint64 constant T0 = 1_000_000;

    bytes32 constant SCHEMA_HASH = keccak256("schema:v1");
    bytes32 constant BODY_HASH = keccak256("body:v1");

    /// @dev Everything needed for one settlement, with all signatures already
    ///      computed. Building this before any cheatcode matters: the helpers make
    ///      view calls into the escrow, and a pending vm.prank / vm.expectRevert
    ///      would be consumed by those instead of by the call under test.
    struct Prepared {
        SLAEscrow.PaymentAuth auth;
        SLAEscrow.ServiceReceipt receipt;
        bytes authSig;
        bytes receiptSig;
        bytes ackSig;
    }

    function setUp() public {
        buyer = vm.addr(BUYER_PK);
        seller = vm.addr(SELLER_PK);

        cusd = new MockERC20();
        escrow = new SLAEscrow(IERC20(address(cusd)), arbiter);

        cusd.mint(seller, 100e18);
        cusd.mint(buyer, 100e18);

        vm.startPrank(seller);
        cusd.approve(address(escrow), type(uint256).max);
        endpointId =
            escrow.registerEndpoint(PRICE, MAX_LATENCY_MS, STATUS_OK, SCHEMA_HASH, WINDOW, BOND);
        vm.stopPrank();

        vm.startPrank(buyer);
        cusd.approve(address(escrow), type(uint256).max);
        escrow.deposit(DEPOSIT);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _prepare(bytes32 requestId, uint16 status, uint64 servedAtMs)
        internal
        view
        returns (Prepared memory p)
    {
        p.auth = SLAEscrow.PaymentAuth({
            buyer: buyer,
            endpointId: endpointId,
            requestId: requestId,
            amount: PRICE,
            requestedAtMs: T0,
            deadline: uint64(block.timestamp + 1 hours)
        });
        p.receipt = SLAEscrow.ServiceReceipt({
            requestId: requestId,
            statusCode: status,
            servedAtMs: servedAtMs,
            bodyHash: BODY_HASH
        });
        p.authSig = _sign(BUYER_PK, escrow.hashPaymentAuth(p.auth));
        p.receiptSig = _sign(SELLER_PK, escrow.hashServiceReceipt(p.receipt));
        p.ackSig = _sign(BUYER_PK, escrow.hashReceiptAck(requestId, BODY_HASH));
    }

    /// @dev An in-SLA call both sides agree on.
    function _ok(bytes32 requestId) internal view returns (Prepared memory) {
        return _prepare(requestId, STATUS_OK, T0 + 500);
    }

    function _settle(Prepared memory p) internal {
        vm.prank(seller);
        escrow.redeemWithAck(p.auth, p.authSig, p.receipt, p.receiptSig, p.ackSig);
    }

    // -----------------------------------------------------------------
    // Fast path
    // -----------------------------------------------------------------

    function test_FastPath_SettlesImmediately() public {
        bytes32 id = keccak256("req-1");
        _settle(_ok(id));

        assertEq(escrow.buyerBalance(buyer), DEPOSIT - PRICE, "buyer debited exactly the price");
        assertEq(escrow.sellerBalance(seller), PRICE, "seller credited immediately");
        assertTrue(escrow.consumed(id), "request marked consumed");
    }

    /// @notice The headline property: the buyer never sends a transaction to pay.
    function test_FastPath_BuyerSendsNoTransaction() public {
        uint256 nonceBefore = vm.getNonce(buyer);
        _settle(_ok(keccak256("req-nogas")));
        assertEq(vm.getNonce(buyer), nonceBefore, "buyer nonce must not move");
        assertEq(escrow.sellerBalance(seller), PRICE, "yet the seller still got paid");
    }

    function test_FastPath_SellerCanWithdraw() public {
        _settle(_ok(keccak256("req-w")));
        uint256 before = cusd.balanceOf(seller);
        vm.prank(seller);
        escrow.withdrawSeller(PRICE);
        assertEq(cusd.balanceOf(seller), before + PRICE);
    }

    function test_Batch_SettlesManyInOneTransaction() public {
        uint256 n = 5;
        SLAEscrow.PaymentAuth[] memory auths = new SLAEscrow.PaymentAuth[](n);
        SLAEscrow.ServiceReceipt[] memory receipts = new SLAEscrow.ServiceReceipt[](n);
        bytes[] memory authSigs = new bytes[](n);
        bytes[] memory receiptSigs = new bytes[](n);
        bytes[] memory ackSigs = new bytes[](n);

        for (uint256 i = 0; i < n; ++i) {
            Prepared memory p = _ok(keccak256(abi.encodePacked("batch", i)));
            auths[i] = p.auth;
            receipts[i] = p.receipt;
            authSigs[i] = p.authSig;
            receiptSigs[i] = p.receiptSig;
            ackSigs[i] = p.ackSig;
        }

        vm.prank(seller);
        escrow.batchRedeemWithAck(auths, authSigs, receipts, receiptSigs, ackSigs);

        assertEq(escrow.sellerBalance(seller), PRICE * n);
        assertEq(escrow.buyerBalance(buyer), DEPOSIT - PRICE * n);
    }

    // -----------------------------------------------------------------
    // Objective SLA enforcement — the part that needs no arbiter
    // -----------------------------------------------------------------

    function test_LatencyBreach_Reverts_AndBuyerKeepsMoney() public {
        // 2500ms against a 2000ms budget.
        Prepared memory p = _prepare(keccak256("req-slow"), STATUS_OK, T0 + 2500);

        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(SLAEscrow.LatencyExceeded.selector, MAX_LATENCY_MS, uint256(2500))
        );
        escrow.redeemWithAck(p.auth, p.authSig, p.receipt, p.receiptSig, p.ackSig);

        assertEq(escrow.buyerBalance(buyer), DEPOSIT, "buyer untouched");
        assertEq(escrow.sellerBalance(seller), 0, "seller unpaid");
    }

    function test_LatencyExactlyAtBudget_Succeeds() public {
        _settle(_prepare(keccak256("req-edge"), STATUS_OK, T0 + MAX_LATENCY_MS));
        assertEq(escrow.sellerBalance(seller), PRICE);
    }

    function test_StatusMismatch_Reverts() public {
        Prepared memory p = _prepare(keccak256("req-500"), 500, T0 + 100);

        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(SLAEscrow.StatusMismatch.selector, STATUS_OK, uint16(500))
        );
        escrow.redeemWithAck(p.auth, p.authSig, p.receipt, p.receiptSig, p.ackSig);

        assertEq(escrow.buyerBalance(buyer), DEPOSIT);
    }

    function test_ClockSkew_Reverts() public {
        Prepared memory p = _prepare(keccak256("req-skew"), STATUS_OK, T0 - 1000);

        vm.prank(seller);
        vm.expectRevert(SLAEscrow.ClockSkew.selector);
        escrow.redeemWithAck(p.auth, p.authSig, p.receipt, p.receiptSig, p.ackSig);
    }

    // -----------------------------------------------------------------
    // Signature and replay safety
    // -----------------------------------------------------------------

    function test_Replay_Reverts() public {
        bytes32 id = keccak256("req-replay");
        Prepared memory p = _ok(id);
        _settle(p);

        vm.prank(seller);
        vm.expectRevert(SLAEscrow.RequestAlreadyConsumed.selector);
        escrow.redeemWithAck(p.auth, p.authSig, p.receipt, p.receiptSig, p.ackSig);
    }

    function test_ForgedAuthSignature_Reverts() public {
        Prepared memory p = _ok(keccak256("req-forge"));
        // Seller signs the buyer's authorization. Nice try.
        p.authSig = _sign(SELLER_PK, escrow.hashPaymentAuth(p.auth));

        vm.prank(seller);
        vm.expectRevert(SLAEscrow.BadAuthSignature.selector);
        escrow.redeemWithAck(p.auth, p.authSig, p.receipt, p.receiptSig, p.ackSig);
    }

    function test_ReceiptSignedByNonSeller_Reverts() public {
        Prepared memory p = _ok(keccak256("req-notseller"));
        p.receiptSig = _sign(BUYER_PK, escrow.hashServiceReceipt(p.receipt));

        vm.prank(seller);
        vm.expectRevert(SLAEscrow.BadReceiptSignature.selector);
        escrow.redeemWithAck(p.auth, p.authSig, p.receipt, p.receiptSig, p.ackSig);
    }

    function test_ForgedAck_Reverts() public {
        bytes32 id = keccak256("req-badack");
        Prepared memory p = _ok(id);
        // Seller forges the buyer's acknowledgement.
        p.ackSig = _sign(SELLER_PK, escrow.hashReceiptAck(id, BODY_HASH));

        vm.prank(seller);
        vm.expectRevert(SLAEscrow.BadAckSignature.selector);
        escrow.redeemWithAck(p.auth, p.authSig, p.receipt, p.receiptSig, p.ackSig);
    }

    function test_AckOverDifferentBody_Reverts() public {
        bytes32 id = keccak256("req-swapbody");
        Prepared memory p = _ok(id);
        // Buyer acked a different body than the receipt commits to.
        p.ackSig = _sign(BUYER_PK, escrow.hashReceiptAck(id, keccak256("something-else")));

        vm.prank(seller);
        vm.expectRevert(SLAEscrow.BadAckSignature.selector);
        escrow.redeemWithAck(p.auth, p.authSig, p.receipt, p.receiptSig, p.ackSig);
    }

    function test_ExpiredAuth_Reverts() public {
        Prepared memory p = _ok(keccak256("req-expired"));

        vm.warp(block.timestamp + 2 hours);

        vm.prank(seller);
        vm.expectRevert(SLAEscrow.AuthExpired.selector);
        escrow.redeemWithAck(p.auth, p.authSig, p.receipt, p.receiptSig, p.ackSig);
    }

    function test_AuthForAnotherEndpoint_Reverts() public {
        // Seller stands up a second endpoint at the same price — so the amount
        // check passes — and tries to redeem a first-endpoint authorization
        // against it. Only the signature binding stands in the way.
        vm.prank(seller);
        bytes32 other =
            escrow.registerEndpoint(PRICE, MAX_LATENCY_MS, STATUS_OK, SCHEMA_HASH, WINDOW, BOND);

        Prepared memory p = _ok(keccak256("req-crossendpoint"));
        p.auth.endpointId = other;

        vm.prank(seller);
        vm.expectRevert(SLAEscrow.BadAuthSignature.selector);
        escrow.redeemWithAck(p.auth, p.authSig, p.receipt, p.receiptSig, p.ackSig);
    }

    // -----------------------------------------------------------------
    // Unilateral path and the challenge game
    // -----------------------------------------------------------------

    function _redeemUnilateral(bytes32 id) internal returns (Prepared memory p) {
        p = _ok(id);
        vm.prank(seller);
        escrow.redeem(p.auth, p.authSig, p.receipt, p.receiptSig);
    }

    function test_Unilateral_PendsThenClaims() public {
        bytes32 id = keccak256("req-uni");
        _redeemUnilateral(id);

        assertEq(escrow.sellerBalance(seller), 0, "not paid during the window");
        assertEq(escrow.lockedBondOf(endpointId), uint256(PRICE) * escrow.SLASH_MULTIPLE());

        vm.warp(block.timestamp + WINDOW + 1);
        escrow.claim(id);

        assertEq(escrow.sellerBalance(seller), PRICE, "paid once window closed");
        assertEq(escrow.lockedBondOf(endpointId), 0, "bond released");
    }

    function test_Unilateral_ClaimBeforeWindow_Reverts() public {
        bytes32 id = keccak256("req-early");
        _redeemUnilateral(id);

        vm.expectRevert(SLAEscrow.WindowNotElapsed.selector);
        escrow.claim(id);
    }

    function test_Unilateral_DoubleClaim_Reverts() public {
        bytes32 id = keccak256("req-double");
        _redeemUnilateral(id);
        vm.warp(block.timestamp + WINDOW + 1);
        escrow.claim(id);

        vm.expectRevert(SLAEscrow.NotPending.selector);
        escrow.claim(id);
    }

    function test_Challenge_BuyerWins_RefundsAndSlashes() public {
        bytes32 id = keccak256("req-garbage");
        _redeemUnilateral(id);

        uint256 challengeBond = uint256(PRICE) * escrow.CHALLENGE_BOND_MULTIPLE();
        uint256 slash = uint256(PRICE) * escrow.SLASH_MULTIPLE();

        vm.prank(buyer);
        escrow.challenge(id);
        assertEq(escrow.buyerBalance(buyer), DEPOSIT - PRICE - challengeBond);

        vm.prank(arbiter);
        escrow.resolve(id, true);

        // Call refunded, challenge bond returned, damages paid out of the seller bond.
        assertEq(escrow.buyerBalance(buyer), DEPOSIT + slash, "buyer made whole plus damages");
        assertEq(escrow.sellerBalance(seller), 0, "seller earns nothing");
        assertEq(escrow.bondOf(endpointId), BOND - slash, "seller bond slashed");
        assertEq(escrow.lockedBondOf(endpointId), 0);
    }

    function test_Challenge_SellerWins_BuyerForfeitsBond() public {
        bytes32 id = keccak256("req-crywolf");
        _redeemUnilateral(id);

        uint256 challengeBond = uint256(PRICE) * escrow.CHALLENGE_BOND_MULTIPLE();

        vm.prank(buyer);
        escrow.challenge(id);

        vm.prank(arbiter);
        escrow.resolve(id, false);

        assertEq(escrow.buyerBalance(buyer), DEPOSIT - PRICE - challengeBond, "bond forfeited");
        assertEq(escrow.sellerBalance(seller), PRICE + challengeBond, "seller keeps fee plus bond");
        assertEq(escrow.bondOf(endpointId), BOND, "seller bond intact");
    }

    function test_Challenge_AfterWindow_Reverts() public {
        bytes32 id = keccak256("req-late");
        _redeemUnilateral(id);

        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(buyer);
        vm.expectRevert(SLAEscrow.WindowElapsed.selector);
        escrow.challenge(id);
    }

    function test_Challenge_ByStranger_Reverts() public {
        bytes32 id = keccak256("req-stranger");
        _redeemUnilateral(id);

        vm.prank(stranger);
        vm.expectRevert(SLAEscrow.NotBuyer.selector);
        escrow.challenge(id);
    }

    function test_ClaimWhileChallenged_Reverts() public {
        bytes32 id = keccak256("req-contested");
        _redeemUnilateral(id);
        vm.prank(buyer);
        escrow.challenge(id);

        vm.warp(block.timestamp + WINDOW + 1);
        vm.expectRevert(SLAEscrow.NotPending.selector);
        escrow.claim(id);
    }

    function test_Resolve_OnlyArbiter() public {
        bytes32 id = keccak256("req-arb");
        _redeemUnilateral(id);
        vm.prank(buyer);
        escrow.challenge(id);

        vm.prank(stranger);
        vm.expectRevert(SLAEscrow.NotArbiter.selector);
        escrow.resolve(id, true);
    }

    // -----------------------------------------------------------------
    // Bond invariants
    // -----------------------------------------------------------------

    function test_RegisterWithThinBond_Reverts() public {
        vm.prank(seller);
        vm.expectRevert(SLAEscrow.BondTooSmall.selector);
        escrow.registerEndpoint(PRICE, MAX_LATENCY_MS, STATUS_OK, SCHEMA_HASH, WINDOW, PRICE * 10);
    }

    function test_ActiveEndpointCannotDropBelowBondFloor() public {
        uint256 floor = uint256(PRICE) * escrow.MIN_BOND_MULTIPLE();
        vm.prank(seller);
        vm.expectRevert(SLAEscrow.BondTooSmall.selector);
        escrow.withdrawBond(endpointId, BOND - floor + 1);
    }

    function test_LockedBondCannotBeWithdrawn() public {
        _redeemUnilateral(keccak256("req-lock"));

        // Deactivate so the floor check is out of the way; the lock alone must bite.
        vm.startPrank(seller);
        escrow.setEndpointActive(endpointId, false);
        vm.expectRevert(SLAEscrow.BondLocked.selector);
        escrow.withdrawBond(endpointId, BOND);
        vm.stopPrank();
    }

    function test_InactiveEndpoint_CannotBeRedeemedAgainst() public {
        Prepared memory p = _ok(keccak256("req-inactive"));

        vm.prank(seller);
        escrow.setEndpointActive(endpointId, false);

        vm.prank(seller);
        vm.expectRevert(SLAEscrow.EndpointInactive.selector);
        escrow.redeemWithAck(p.auth, p.authSig, p.receipt, p.receiptSig, p.ackSig);
    }

    // -----------------------------------------------------------------
    // Solvency
    // -----------------------------------------------------------------

    /// @notice Whatever the path, the contract must hold at least what it owes.
    function test_Solvency_AfterMixedActivity() public {
        _settle(_ok(keccak256("s1")));
        _settle(_ok(keccak256("s2")));

        bytes32 id = keccak256("s3");
        _redeemUnilateral(id);
        vm.prank(buyer);
        escrow.challenge(id);
        vm.prank(arbiter);
        escrow.resolve(id, true);

        uint256 owed =
            escrow.buyerBalance(buyer) + escrow.sellerBalance(seller) + escrow.bondOf(endpointId);
        assertGe(cusd.balanceOf(address(escrow)), owed, "contract must cover every claim");
    }

    function testFuzz_LatencyEnforcement(uint32 servedOffsetMs) public {
        servedOffsetMs = uint32(bound(servedOffsetMs, 0, 1_000_000));
        Prepared memory p =
            _prepare(keccak256(abi.encodePacked("fuzz", servedOffsetMs)), STATUS_OK, T0 + servedOffsetMs);

        if (servedOffsetMs > MAX_LATENCY_MS) {
            vm.prank(seller);
            vm.expectRevert(
                abi.encodeWithSelector(
                    SLAEscrow.LatencyExceeded.selector, MAX_LATENCY_MS, uint256(servedOffsetMs)
                )
            );
            escrow.redeemWithAck(p.auth, p.authSig, p.receipt, p.receiptSig, p.ackSig);
            assertEq(escrow.buyerBalance(buyer), DEPOSIT, "no debit on a breach");
        } else {
            vm.prank(seller);
            escrow.redeemWithAck(p.auth, p.authSig, p.receipt, p.receiptSig, p.ackSig);
            assertEq(escrow.sellerBalance(seller), PRICE);
        }
    }
}
