// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

/**
 * @title zOPALStakingVaultRoles
 * @notice Base contract that stores all roles descriptors for zOPAL Staking Vault
 * @author Zoth Protocol
 */
abstract contract zOPALStakingVaultRoles {
    /**
     * @notice actor that can manage zOPAL Staking Vault admin functions
     */
    bytes32 public constant STAKING_VAULT_ADMIN_ROLE =
        keccak256("STAKING_VAULT_ADMIN_ROLE");

    /**
     * @notice actor that can pause/unpause the staking vault
     */
    bytes32 public constant STAKING_VAULT_PAUSE_OPERATOR_ROLE =
        keccak256("STAKING_VAULT_PAUSE_OPERATOR_ROLE");
}
