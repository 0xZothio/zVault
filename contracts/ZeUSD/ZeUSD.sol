// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";

import "../access/Blacklistable.sol";
import "../interfaces/IZToken.sol";

/**
 * @title ZeUSD
 * @author RedDuck Software
 */
contract ZeUSD is ERC20PausableUpgradeable, Blacklistable, IZToken {
    /**
     * @notice metadata key => metadata value
     */
    mapping(bytes32 => bytes) public metadata;

    /**
     * @dev leaving a storage gap for futures updates
     */
    uint256[50] private __gap;

    /**
     * @notice upgradeable pattern contract`s initializer
     * @param _accessControl address of ZothAccessControl contract
     */
    function initialize(address _accessControl) external virtual initializer {
        __Blacklistable_init(_accessControl);
        __ERC20_init("ZeUSD", "ZeUSD");
    }

    /**
     * @inheritdoc IZToken
     */
    function mint(
        address to,
        uint256 amount
    ) external onlyRole(_minterRole(), msg.sender) {
        _mint(to, amount);
    }

    /**
     * @inheritdoc IZToken
     */
    function burn(
        address from,
        uint256 amount
    ) external onlyRole(_burnerRole(), msg.sender) {
        _burn(from, amount);
    }

    /**
     * @inheritdoc IZToken
     */
    function pause() external override onlyRole(_pauserRole(), msg.sender) {
        _pause();
    }

    /**
     * @inheritdoc IZToken
     */
    function unpause() external override onlyRole(_pauserRole(), msg.sender) {
        _unpause();
    }

    /**
     * @inheritdoc IZToken
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
     * @dev AC role, owner of which can mint ZeUSD token
     */
    function _minterRole() internal pure virtual returns (bytes32) {
        return ZEUSD_MINT_OPERATOR_ROLE;
    }

    /**
     * @dev AC role, owner of which can burn ZeUSD token
     */
    function _burnerRole() internal pure virtual returns (bytes32) {
        return ZEUSD_BURN_OPERATOR_ROLE;
    }

    /**
     * @dev AC role, owner of which can pause ZeUSD token
     */
    function _pauserRole() internal pure virtual returns (bytes32) {
        return ZEUSD_PAUSE_OPERATOR_ROLE;
    }
}
