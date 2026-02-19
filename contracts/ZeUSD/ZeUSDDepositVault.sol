// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../DepositVault.sol";
import "./ZeUSDZothAccessControlRoles.sol";

/**
 * @title ZeUSDDepositVault
 * @notice Smart contract that handles ZeUSD minting
 * @author RedDuck Software
 */
contract ZeUSDDepositVault is DepositVault, ZeUSDZothAccessControlRoles {
    /**
     * @dev leaving a storage gap for futures updates
     */
    uint256[50] private __gap;

    /**
     * @inheritdoc ManageableVault
     */
    function vaultRole() public pure override returns (bytes32) {
        return ZEUSD_DEPOSIT_VAULT_ADMIN_ROLE;
    }
}
