// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title FunctionsAccessControl
 * @notice Access control contract for Chainlink Functions operations
 * @dev Defines roles for managing Chainlink Functions consumer contract
 */
contract FunctionsAccessControl is AccessControl {
    // Role definitions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant REQUESTER_ROLE = keccak256("REQUESTER_ROLE");
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant PRICE_ADMIN_ROLE = keccak256("PRICE_ADMIN_ROLE");

    /**
     * @notice Events
     */
    event AdminRoleGranted(address indexed account, address indexed sender);
    event RequesterRoleGranted(address indexed account, address indexed sender);
    event ConfigRoleGranted(address indexed account, address indexed sender);
    event PriceAdminRoleGranted(
        address indexed account,
        address indexed sender
    );

    /**
     * @notice Constructor sets up the initial admin
     * @param initialAdmin The address that will have all roles initially
     */
    constructor(address initialAdmin) {
        require(initialAdmin != address(0), "Invalid admin address");

        // Grant DEFAULT_ADMIN_ROLE to initial admin (this can manage all roles)
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);

        // Grant all operational roles to initial admin
        _grantRole(ADMIN_ROLE, initialAdmin);
        _grantRole(REQUESTER_ROLE, initialAdmin);
        _grantRole(CONFIG_ROLE, initialAdmin);
        _grantRole(PRICE_ADMIN_ROLE, initialAdmin);

        emit AdminRoleGranted(initialAdmin, msg.sender);
        emit RequesterRoleGranted(initialAdmin, msg.sender);
        emit ConfigRoleGranted(initialAdmin, msg.sender);
        emit PriceAdminRoleGranted(initialAdmin, msg.sender);
    }

    /**
     * @notice Grant admin role to an account
     * @param account The account to grant the role to
     */
    function grantAdminRole(
        address account
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(ADMIN_ROLE, account);
        emit AdminRoleGranted(account, msg.sender);
    }

    /**
     * @notice Grant requester role to an account
     * @param account The account to grant the role to
     */
    function grantRequesterRole(
        address account
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(REQUESTER_ROLE, account);
        emit RequesterRoleGranted(account, msg.sender);
    }

    /**
     * @notice Grant config role to an account
     * @param account The account to grant the role to
     */
    function grantConfigRole(
        address account
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(CONFIG_ROLE, account);
        emit ConfigRoleGranted(account, msg.sender);
    }

    /**
     * @notice Revoke admin role from an account
     * @param account The account to revoke the role from
     */
    function revokeAdminRole(
        address account
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(ADMIN_ROLE, account);
    }

    /**
     * @notice Revoke requester role from an account
     * @param account The account to revoke the role from
     */
    function revokeRequesterRole(
        address account
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(REQUESTER_ROLE, account);
    }

    /**
     * @notice Revoke config role from an account
     * @param account The account to revoke the role from
     */
    function revokeConfigRole(
        address account
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(CONFIG_ROLE, account);
    }

    /**
     * @notice Grant price admin role to an account
     * @param account The account to grant the role to
     */
    function grantPriceAdminRole(
        address account
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(PRICE_ADMIN_ROLE, account);
        emit PriceAdminRoleGranted(account, msg.sender);
    }

    /**
     * @notice Revoke price admin role from an account
     * @param account The account to revoke the role from
     */
    function revokePriceAdminRole(
        address account
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(PRICE_ADMIN_ROLE, account);
    }
}
