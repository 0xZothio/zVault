// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../interfaces/ISanctionsList.sol";

/**
 * @title MockSanctionsList
 * @notice Mock Chainalysis sanctions oracle for testing purposes
 * @dev Allows test scripts to mark addresses as sanctioned
 */
contract MockSanctionsList is ISanctionsList {
    mapping(address => bool) private _sanctioned;

    function setSanctioned(address addr, bool status) external {
        _sanctioned[addr] = status;
    }

    function isSanctioned(address addr) external view override returns (bool) {
        return _sanctioned[addr];
    }
}
