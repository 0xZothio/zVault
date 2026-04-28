// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./FunctionsAccessControl.sol";

/**
 * @title WithFunctionsAccessControl
 * @notice Base contract that provides access control functionality
 * @dev Contracts that need role-based access control should inherit from this
 */
abstract contract WithFunctionsAccessControl {
    /**
     * @notice FunctionsAccessControl contract reference
     */
    FunctionsAccessControl public accessControl;

    /**
     * @notice Error thrown when an account doesn't have the required role
     */
    error UnauthorizedAccess(address account, bytes32 role);

    /**
     * @dev Modifier to check if the caller has a specific role
     * @param role The role to check
     */
    modifier onlyRole(bytes32 role) {
        if (!accessControl.hasRole(role, msg.sender)) {
            revert UnauthorizedAccess(msg.sender, role);
        }
        _;
    }

    /**
     * @dev Internal function to initialize the access control
     * @param _accessControl Address of the FunctionsAccessControl contract
     */
    function _initializeAccessControl(address _accessControl) internal {
        require(_accessControl != address(0), "Invalid access control address");
        accessControl = FunctionsAccessControl(_accessControl);
    }
}
