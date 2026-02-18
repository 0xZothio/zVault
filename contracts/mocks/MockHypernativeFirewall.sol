// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../interfaces/IHypernativeFirewall.sol";

/**
 * @title MockHypernativeFirewall
 * @notice Mock firewall for testing - allows all operations
 */
contract MockHypernativeFirewall is IHypernativeFirewall {
    function validateForbiddenAccountInteraction(
        address /* sender */
    ) external pure override {
        // Allow all
    }

    function validateForbiddenContextInteraction(
        address /* origin */,
        address /* sender */
    ) external pure override {
        // Allow all
    }

    function validateBlacklistedAccountInteraction(
        address /* account */
    ) external pure override {
        // Allow all
    }

    function register(address /* account */, bool /* isStrictMode */) external override {
        // No-op
    }
}
