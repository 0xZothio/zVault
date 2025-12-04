// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;
/**
 * @title IDepositVault
 * @author RedDuck Software
 */
interface IDepositVault  {
    function depositInstant(
        address tokenIn,
        uint256 amountToken,
        uint256 minReceiveAmount,
        bytes32 referrerId
    ) external;
}
