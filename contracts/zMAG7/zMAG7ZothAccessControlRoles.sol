// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

/**
 * @title zMAG7ZothAccessControlRoles
 * @notice Role identifiers for zMAG7 contracts. These are distinct from zOPAL
 * roles so MAG7 vaults cannot mint/burn zOPAL (and vice versa) even though both
 * products share the same ZothAccessControl instance.
 * @author Zoth
 */
abstract contract zMAG7ZothAccessControlRoles {
    /**
     * @notice actor that can manage zMAG7DepositVault
     */
    bytes32 public constant MAG7_DEPOSIT_VAULT_ADMIN_ROLE =
        keccak256("MAG7_DEPOSIT_VAULT_ADMIN_ROLE");

    /**
     * @notice actor that can manage zMAG7RedemptionVault
     */
    bytes32 public constant MAG7_REDEMPTION_VAULT_ADMIN_ROLE =
        keccak256("MAG7_REDEMPTION_VAULT_ADMIN_ROLE");

    /**
     * @notice actor that can manage the MAG7 price oracle / data feed
     */
    bytes32 public constant MAG7_CUSTOM_AGGREGATOR_FEED_ADMIN_ROLE =
        keccak256("MAG7_CUSTOM_AGGREGATOR_FEED_ADMIN_ROLE");

    /**
     * @notice actor that can mint zMAG7
     */
    bytes32 public constant MAG7_MINT_OPERATOR_ROLE =
        keccak256("MAG7_MINT_OPERATOR_ROLE");

    /**
     * @notice actor that can burn zMAG7
     */
    bytes32 public constant MAG7_BURN_OPERATOR_ROLE =
        keccak256("MAG7_BURN_OPERATOR_ROLE");

    /**
     * @notice actor that can pause zMAG7
     */
    bytes32 public constant MAG7_PAUSE_OPERATOR_ROLE =
        keccak256("MAG7_PAUSE_OPERATOR_ROLE");
}
