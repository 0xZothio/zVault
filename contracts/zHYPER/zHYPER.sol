// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import "../access/Blacklistable.sol";

/**
 * @title zHYPER
 * @author RedDuck Software
 */
//solhint-disable contract-name-camelcase
contract zHYPER is ERC20PausableUpgradeable, Blacklistable {
    /**
     * @notice metadata key => metadata value
     */
    mapping(bytes32 => bytes) public metadata;

    /**
     * @notice actor that can mint zHYPER
     */
    bytes32 public constant Z_HYPER_MINT_OPERATOR_ROLE =
        keccak256("Z_HYPER_MINT_OPERATOR_ROLE");

    /**
     * @notice actor that can burn zHYPER
     */
    bytes32 public constant Z_HYPER_BURN_OPERATOR_ROLE =
        keccak256("Z_HYPER_BURN_OPERATOR_ROLE");

    /**
     * @notice actor that can pause zHYPER
     */
    bytes32 public constant Z_HYPER_PAUSE_OPERATOR_ROLE =
        keccak256("Z_HYPER_PAUSE_OPERATOR_ROLE");

    /**
     * @dev leaving a storage gap for futures updates
     */
    uint256[50] private __gap;

    /**
     * @notice upgradeable pattern contract`s initializer
     * @param _accessControl address of ZothAccessControl contract
     */
    function initialize(address _accessControl) external initializer {
        __Blacklistable_init(_accessControl);
        __ERC20_init("Zoth Hyperithm", "zHYPER");
    }

    /**
     * @notice mints zHYPER token `amount` to a given `to` address.
     * should be called only from permissioned actor
     * @param to addres to mint tokens to
     * @param amount amount to mint
     */
    function mint(
        address to,
        uint256 amount
    ) external onlyRole(_minterRole(), msg.sender) {
        _mint(to, amount);
    }

    /**
     * @notice burns zHYPER token `amount` to a given `to` address.
     * should be called only from permissioned actor
     * @param from addres to burn tokens from
     * @param amount amount to burn
     */
    function burn(
        address from,
        uint256 amount
    ) external onlyRole(_burnerRole(), msg.sender) {
        _burn(from, amount);
    }

    /**
     * @notice puts zHYPER token on pause.
     * should be called only from permissioned actor
     */
    function pause() external onlyRole(_pauserRole(), msg.sender) {
        _pause();
    }

    /**
     * @notice puts zHYPER token on pause.
     * should be called only from permissioned actor
     */
    function unpause() external onlyRole(_pauserRole(), msg.sender) {
        _unpause();
    }

    /**
     * @notice updates contract`s metadata.
     * should be called only from permissioned actor
     * @param key metadata map. key
     * @param data metadata map. value
     */
    function setMetadata(
        bytes32 key,
        bytes memory data
    ) external onlyRole(DEFAULT_ADMIN_ROLE, msg.sender) {
        metadata[key] = data;
    }

    /**
     * @dev overrides _beforeTokenTransfer function to ban
     * blaclisted users from using the token functions
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20PausableUpgradeable) {
        if (to != address(0)) {
            _onlyNotBlacklisted(from);
            _onlyNotBlacklisted(to);
        }

        ERC20PausableUpgradeable._beforeTokenTransfer(from, to, amount);
    }

    /**
     * @dev AC role, owner of which can mint zHYPER token
     */
    function _minterRole() internal pure returns (bytes32) {
        return Z_HYPER_MINT_OPERATOR_ROLE;
    }

    /**
     * @dev AC role, owner of which can burn zHYPER token
     */
    function _burnerRole() internal pure returns (bytes32) {
        return Z_HYPER_BURN_OPERATOR_ROLE;
    }

    /**
     * @dev AC role, owner of which can pause zHYPER token
     */
    function _pauserRole() internal pure returns (bytes32) {
        return Z_HYPER_PAUSE_OPERATOR_ROLE;
    }
}
