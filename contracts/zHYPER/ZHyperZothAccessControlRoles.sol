// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

/**
 * @title ZHyperZothAccessControlRoles
 * @notice Base contract that stores all roles descriptors for zHYPER contracts
 * @author RedDuck Software
 */
abstract contract ZHyperZothAccessControlRoles {
    /**
     * @notice actor that can manage ZHyperDepositVault
     */
    bytes32 public constant Z_HYPER_DEPOSIT_VAULT_ADMIN_ROLE =
        keccak256("Z_HYPER_DEPOSIT_VAULT_ADMIN_ROLE");

    /**
     * @notice actor that can manage ZHyperRedemptionVault
     */
    bytes32 public constant Z_HYPER_REDEMPTION_VAULT_ADMIN_ROLE =
        keccak256("Z_HYPER_REDEMPTION_VAULT_ADMIN_ROLE");

    /**
     * @notice actor that can manage ZHyperCustomAggregatorFeed and ZHyperDataFeed
     */
    bytes32 public constant Z_HYPER_CUSTOM_AGGREGATOR_FEED_ADMIN_ROLE =
        keccak256("Z_HYPER_CUSTOM_AGGREGATOR_FEED_ADMIN_ROLE");
}

