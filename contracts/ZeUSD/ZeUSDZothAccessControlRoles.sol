// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

/**
 * @title ZeUSDZothAccessControlRoles
 * @notice Base contract that stores all roles descriptors for ZeUSD contracts
 * @author RedDuck Software
 */
abstract contract ZeUSDZothAccessControlRoles {
    /**
     * @notice actor that can manage ZeUSDDepositVault
     */
    bytes32 public constant ZEUSD_DEPOSIT_VAULT_ADMIN_ROLE =
        keccak256("ZEUSD_DEPOSIT_VAULT_ADMIN_ROLE");

    /**
     * @notice actor that can manage ZeUSDRedemptionVault
     */
    bytes32 public constant ZEUSD_REDEMPTION_VAULT_ADMIN_ROLE =
        keccak256("ZEUSD_REDEMPTION_VAULT_ADMIN_ROLE");

    /**
     * @notice actor that can manage ZeUSDCustomAggregatorFeed and ZeUSDDataFeed
     */
    bytes32 public constant ZEUSD_CUSTOM_AGGREGATOR_FEED_ADMIN_ROLE =
        keccak256("ZEUSD_CUSTOM_AGGREGATOR_FEED_ADMIN_ROLE");
}
