// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

/**
 * @title ZothAccessControlRoles
 * @notice Base contract that stores all roles descriptors
 * @author RedDuck Software
 */
abstract contract ZothAccessControlRoles {
    /**
     * @notice actor that can change green list statuses of addresses
     */
    bytes32 public constant GREENLIST_OPERATOR_ROLE =
        keccak256("GREENLIST_OPERATOR_ROLE");

    /**
     * @notice actor that can change black list statuses of addresses
     */
    bytes32 public constant BLACKLIST_OPERATOR_ROLE =
        keccak256("BLACKLIST_OPERATOR_ROLE");

    /**
     * @notice actor that can mint zOPAL
     */
    bytes32 public constant ZOPAL_MINT_OPERATOR_ROLE =
        keccak256("ZOPAL_MINT_OPERATOR_ROLE");

    /**
     * @notice actor that can burn zOPAL
     */
    bytes32 public constant ZOPAL_BURN_OPERATOR_ROLE =
        keccak256("ZOPAL_BURN_OPERATOR_ROLE");

    /**
     * @notice actor that can pause zOPAL
     */
    bytes32 public constant ZOPAL_PAUSE_OPERATOR_ROLE =
        keccak256("ZOPAL_PAUSE_OPERATOR_ROLE");

    /**
     * @notice actor that have admin rights in deposit vault
     */
    bytes32 public constant DEPOSIT_VAULT_ADMIN_ROLE =
        keccak256("DEPOSIT_VAULT_ADMIN_ROLE");

    /**
     * @notice actor that have admin rights in redemption vault
     */
    bytes32 public constant REDEMPTION_VAULT_ADMIN_ROLE =
        keccak256("REDEMPTION_VAULT_ADMIN_ROLE");

    /**
     * @notice actor that is greenlisted
     */
    bytes32 public constant GREENLISTED_ROLE = keccak256("GREENLISTED_ROLE");

    /**
     * @notice actor that is blacklisted
     */
    bytes32 public constant BLACKLISTED_ROLE = keccak256("BLACKLISTED_ROLE");
}
