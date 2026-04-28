// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./ZothAccessControl.sol";
import "../abstract/ZothInitializable.sol";

/**
 * @title WithZothAccessControl
 * @notice Base contract that consumes ZothAccessControl
 * @author Zoth
 */
abstract contract WithZothAccessControl is
    ZothInitializable,
    ZothAccessControlRoles
{
    /**
     * @notice admin role
     */
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    /**
     * @notice ZothAccessControl contract address
     */
    ZothAccessControl public accessControl;

    /**
     * @dev leaving a storage gap for futures updates
     */
    uint256[50] private __gap;

    /**
     * @dev checks that given `address` have `role`
     */
    modifier onlyRole(bytes32 role, address account) {
        _onlyRole(role, account);
        _;
    }

    /**
     * @dev checks that given `address` do not have `role`
     */
    modifier onlyNotRole(bytes32 role, address account) {
        _onlyNotRole(role, account);
        _;
    }

    /**
     * @dev upgradeable pattern contract`s initializer
     */
    // solhint-disable func-name-mixedcase
    function __WithZothAccessControl_init(
        address _accessControl
    ) internal onlyInitializing {
        require(_accessControl != address(0), "zero address");
        accessControl = ZothAccessControl(_accessControl);
    }

    /**
     * @dev checks that given `address` have `role`
     */
    function _onlyRole(bytes32 role, address account) internal view {
        require(accessControl.hasRole(role, account), "WZAC: hasnt role");
    }

    /**
     * @dev checks that given `address` do not have `role`
     */
    function _onlyNotRole(bytes32 role, address account) internal view {
        require(!accessControl.hasRole(role, account), "WZAC: has role");
    }
}

