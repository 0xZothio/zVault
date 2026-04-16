// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";

import "../access/Blacklistable.sol";
import "../abstract/WithSanctionsList.sol";
import "../interfaces/IZToken.sol";

/**
 * @title zOPAL
 * @notice zOPAL token with blacklist and sanctions list enforcement on transfers
 * @dev Prevents sanctioned users from transferring tokens to bypass redemption blocks
 * @author Zoth
 */
contract zOPAL is ERC20PausableUpgradeable, Blacklistable, WithSanctionsList, IZToken {
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
     * @param _sanctionsList address of Chainalysis sanctions oracle (use address(0) to disable)
     */
    function initialize(
        address _accessControl,
        address _sanctionsList
    ) external virtual initializer {
        __Blacklistable_init(_accessControl);
        __WithSanctionsList_init_unchained(_sanctionsList);
        __ERC20_init("Zoth BlackOpal", "zOPAL");
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
     * blacklisted and sanctioned users from using the token functions
     * @notice Sanctioned users cannot send OR receive tokens, preventing bypass via transfers
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20PausableUpgradeable) {
        // Check sanctions for sender (skip on mint where from = address(0))
        if (from != address(0)) {
            _requireNotSanctioned(from);
            _onlyNotBlacklisted(from);
        }

        // Check sanctions for recipient (skip on burn where to = address(0))
        if (to != address(0)) {
            _requireNotSanctioned(to);
            _onlyNotBlacklisted(to);
        }

        ERC20PausableUpgradeable._beforeTokenTransfer(from, to, amount);
    }

    /**
     * @dev Internal function to check if address is sanctioned
     * @param account address to check
     */
    function _requireNotSanctioned(address account) internal view {
        address _sanctionsList = sanctionsList;
        if (_sanctionsList != address(0)) {
            require(
                !ISanctionsList(_sanctionsList).isSanctioned(account),
                "zOPAL: sanctioned"
            );
        }
    }

    /**
     * @notice Check if an address is sanctioned
     * @param account address to check
     * @return true if sanctioned, false otherwise
     */
    function isSanctioned(address account) external view returns (bool) {
        address _sanctionsList = sanctionsList;
        if (_sanctionsList == address(0)) return false;
        return ISanctionsList(_sanctionsList).isSanctioned(account);
    }

    /**
     * @notice AC role of sanctions list admin
     * @dev Returns DEFAULT_ADMIN_ROLE - only admin can update sanctions list
     * @return role bytes32 role
     */
    function sanctionsListAdminRole() public pure override returns (bytes32) {
        return DEFAULT_ADMIN_ROLE;
    }

    /**
     * @dev AC role, owner of which can mint zOPAL token
     */
    function _minterRole() internal pure virtual returns (bytes32) {
        return ZOPAL_MINT_OPERATOR_ROLE;
    }

    /**
     * @dev AC role, owner of which can burn zOPAL token
     */
    function _burnerRole() internal pure virtual returns (bytes32) {
        return ZOPAL_BURN_OPERATOR_ROLE;
    }

    /**
     * @dev AC role, owner of which can pause zOPAL token
     */
    function _pauserRole() internal pure virtual returns (bytes32) {
        return ZOPAL_PAUSE_OPERATOR_ROLE;
    }
}
