// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../RedemptionVault.sol";
import "./zMAG7ZothAccessControlRoles.sol";

/**
 * @title zMAG7RedemptionVault
 * @notice Smart contract that handles zMAG7 redemptions
 * @author Zoth
 */
contract zMAG7RedemptionVault is RedemptionVault, zMAG7ZothAccessControlRoles {
    /**
     * @dev leaving a storage gap for futures updates
     */
    uint256[50] private __gap;

    /**
     * @inheritdoc RedemptionVault
     */
    function vaultRole() public pure override returns (bytes32) {
        return MAG7_REDEMPTION_VAULT_ADMIN_ROLE;
    }
}
