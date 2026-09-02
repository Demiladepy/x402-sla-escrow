// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {SLAEscrow} from "../src/SLAEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "../test/MockERC20.sol";

/**
 * Deploys SLAEscrow against an existing settlement asset.
 *
 * TOKEN is read from the environment rather than hardcoded so the same script
 * works on Celo mainnet (cUSD), Celo Sepolia, and a local anvil, and so nobody
 * ships against a stablecoin address copied from the wrong network.
 *
 *   forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url $RPC_URL --broadcast \
 *     --private-key $PRIVATE_KEY
 */
contract Deploy is Script {
    function run() external returns (SLAEscrow escrow) {
        address token = vm.envAddress("TOKEN");
        address arbiter = vm.envOr("ARBITER", msg.sender);

        vm.startBroadcast();
        escrow = new SLAEscrow(IERC20(token), arbiter);
        vm.stopBroadcast();

        console.log("SLAEscrow:", address(escrow));
        console.log("token:    ", token);
        console.log("arbiter:  ", arbiter);
    }
}

/**
 * Local-only convenience: deploys a mock settlement asset alongside the escrow
 * and funds the demo buyer and seller. Never use this against a real network.
 */
contract DeployLocal is Script {
    function run() external returns (SLAEscrow escrow, MockERC20 token) {
        address buyer = vm.envAddress("DEMO_BUYER");
        address seller = vm.envAddress("DEMO_SELLER");

        vm.startBroadcast();
        token = new MockERC20();
        escrow = new SLAEscrow(IERC20(address(token)), msg.sender);
        token.mint(buyer, 1_000e18);
        token.mint(seller, 1_000e18);
        vm.stopBroadcast();

        console.log("SLAEscrow:", address(escrow));
        console.log("token:    ", address(token));
        console.log("buyer:    ", buyer);
        console.log("seller:   ", seller);
    }
}
