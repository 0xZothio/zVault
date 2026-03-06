// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

/**
 * @title zOPALZothAccessControlRoles
 * @notice Base contract that stores all roles descriptors for zOPAL contracts
 * @author RedDuck Software
 */
abstract contract zOPALZothAccessControlRoles {
    /**
     * @notice actor that can manage zOPALDepositVault
     */
    bytes32 public constant ZOPAL_DEPOSIT_VAULT_ADMIN_ROLE =
        keccak256("ZOPAL_DEPOSIT_VAULT_ADMIN_ROLE");

    /**
     * @notice actor that can manage zOPALRedemptionVault
     */
    bytes32 public constant ZOPAL_REDEMPTION_VAULT_ADMIN_ROLE =
        keccak256("ZOPAL_REDEMPTION_VAULT_ADMIN_ROLE");

    /**
     * @notice actor that can manage zOPALCustomAggregatorFeed and zOPALDataFeed
     */
    bytes32 public constant ZOPAL_CUSTOM_AGGREGATOR_FEED_ADMIN_ROLE =
        keccak256("ZOPAL_CUSTOM_AGGREGATOR_FEED_ADMIN_ROLE");
}
