// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title UpgradeTimelock
 * @notice Timelock controller for contract upgrades
 * @dev All ProxyAdmin operations must go through this timelock
 * 
 * Upgrade Process:
 * 1. Proposer schedules upgrade via schedule() or scheduleBatch()
 * 2. Wait for minDelay (e.g., 24-48 hours)
 * 3. Executor calls execute() or executeBatch() to perform upgrade
 * 
 * This gives users time to exit if they disagree with the upgrade.
 */
contract UpgradeTimelock is TimelockController {
    /**
     * @notice Constructor
     * @param minDelay Minimum delay in seconds between scheduling and execution
     * @param proposers Array of addresses that can schedule operations
     * @param executors Array of addresses that can execute operations (use address(0) for anyone)
     * @param admin Address that can grant/revoke roles (use address(0) to disable admin)
     */
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {}
}
