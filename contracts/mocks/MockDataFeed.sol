// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../interfaces/IDataFeed.sol";

/**
 * @title MockDataFeed
 * @notice Mock IDataFeed for testing vault behavior with controlled oracle responses
 * @dev Allows tests to simulate stale prices, zero prices, and custom rates
 */
contract MockDataFeed is IDataFeed {
    uint256 private _price;
    uint256 private _lastUpdateTimestamp;
    bool private _shouldRevert;
    string private _revertMessage;

    constructor(uint256 initialPrice) {
        _price = initialPrice;
        _lastUpdateTimestamp = block.timestamp;
    }

    function setPrice(uint256 price) external {
        _price = price;
        _lastUpdateTimestamp = block.timestamp;
    }

    function setShouldRevert(bool shouldRevert_, string memory message) external {
        _shouldRevert = shouldRevert_;
        _revertMessage = message;
    }

    function getDataInBase18() external view override returns (uint256) {
        if (_shouldRevert) revert(_revertMessage);
        return _price;
    }

    function feedAdminRole() external pure override returns (bytes32) {
        return bytes32(0);
    }

    function getLastUpdateTimestamp() external view override returns (uint256) {
        return _lastUpdateTimestamp;
    }
}
