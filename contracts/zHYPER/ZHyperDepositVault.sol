// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../DepositVault.sol";
import "./ZHyperMidasAccessControlRoles.sol";

/**
 * @title ZHyperDepositVault
 * @notice Smart contract that handles zHYPER minting
 * @author RedDuck Software
 */
contract ZHyperDepositVault is DepositVault, ZHyperMidasAccessControlRoles {
    /**
     * @dev leaving a storage gap for futures updates
     */
    uint256[50] private __gap;

    /**
     * @inheritdoc ManageableVault
     */
    function vaultRole() public pure override returns (bytes32) {
        return Z_HYPER_DEPOSIT_VAULT_ADMIN_ROLE;
    }
}
