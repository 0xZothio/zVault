// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../DepositVault.sol";
import "./zOPALZothAccessControlRoles.sol";

/**
 * @title zOPALDepositVault
 * @notice Smart contract that handles zOPAL minting
 * @author RedDuck Software
 */
contract zOPALDepositVault is DepositVault, zOPALZothAccessControlRoles {
    /**
     * @dev leaving a storage gap for futures updates
     */
    uint256[50] private __gap;

    /**
     * @inheritdoc ManageableVault
     */
    function vaultRole() public pure override returns (bytes32) {
        return ZOPAL_DEPOSIT_VAULT_ADMIN_ROLE;
    }
}
