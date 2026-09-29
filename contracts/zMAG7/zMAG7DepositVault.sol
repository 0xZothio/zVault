// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../DepositVault.sol";
import "./zMAG7ZothAccessControlRoles.sol";

/**
 * @title zMAG7DepositVault
 * @notice Smart contract that handles zMAG7 minting
 * @author Zoth
 */
contract zMAG7DepositVault is DepositVault, zMAG7ZothAccessControlRoles {
    /**
     * @dev leaving a storage gap for futures updates
     */
    uint256[50] private __gap;

    /**
     * @inheritdoc ManageableVault
     */
    function vaultRole() public pure override returns (bytes32) {
        return MAG7_DEPOSIT_VAULT_ADMIN_ROLE;
    }
}
