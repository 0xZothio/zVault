// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./IZToken.sol";
import "./IDataFeed.sol";
import "./IVaultShared.sol";

/**
 * @title IManageableVaultRedeem
 * @author RedDuck Software
 * @notice Interface for redemption vault with different addPaymentToken signature (no allowance parameter)
 * @dev Shared types and events are imported from IVaultShared.sol.
 *      Only AddPaymentToken event differs (no allowance parameter).
 */
interface IManageableVaultRedeem is IVaultSharedEvents {
    /**
     * @param caller function caller (msg.sender)
     * @param token address of token that
     * @param dataFeed token dataFeed address
     * @param fee fee 1% = 100
     * @param stable stablecoin flag
     * @dev This event is different from IManageableVault.AddPaymentToken (which includes allowance parameter)
     */
    event AddPaymentToken(
        address indexed caller,
        address indexed token,
        address indexed dataFeed,
        uint256 fee,
        bool stable
    );

    /**
     * @notice The zTokenDataFeed contract address.
     * @return The address of the zTokenDataFeed contract.
     */
    function zTokenDataFeed() external view returns (IDataFeed);

    /**
     * @notice The zToken contract address.
     * @return The address of the zToken contract.
     */
    function zToken() external view returns (IZToken);

    /**
     * @notice withdraws `amount` of a given `token` from the contract.
     * can be called only from permissioned actor.
     * @param token token address
     * @param amount token amount
     * @param withdrawTo withdraw destination address
     */
    function withdrawToken(
        address token,
        uint256 amount,
        address withdrawTo
    ) external;

    /**
     * @notice adds a token to the stablecoins list.
     * can be called only from permissioned actor.
     * @dev Different signature than IManageableVault.addPaymentToken (no allowance parameter)
     * @param token token address
     * @param dataFeed dataFeed address
     * @param fee 1% = 100
     * @param stable is stablecoin flag
     */
    function addPaymentToken(
        address token,
        address dataFeed,
        uint256 fee,
        bool stable
    ) external;

    /**
     * @notice removes a token from stablecoins list.
     * can be called only from permissioned actor.
     * @param token token address
     */
    function removePaymentToken(address token) external;

    /**
     * @notice set new token allowance.
     * if MAX_UINT = infinite allowance
     * prev allowance rewrites by new
     * can be called only from permissioned actor.
     * @param token token address
     * @param allowance new allowance (decimals 18)
     */
    function changeTokenAllowance(address token, uint256 allowance) external;

    /**
     * @notice set new token fee.
     * can be called only from permissioned actor.
     * @param token token address
     * @param fee new fee percent 1% = 100
     */
    function changeTokenFee(address token, uint256 fee) external;

    /**
     * @notice set new prices diviation percent.
     * can be called only from permissioned actor.
     * @param tolerance new prices diviation percent 1% = 100
     */
    function setVariationTolerance(uint256 tolerance) external;

    /**
     * @notice set new min amount.
     * can be called only from permissioned actor.
     * @param newAmount min amount for operations in zToken
     */
    function setMinAmount(uint256 newAmount) external;

    /**
     * @notice adds a account to waived fee restriction.
     * can be called only from permissioned actor.
     * @param account user address
     */
    function addWaivedFeeAccount(address account) external;

    /**
     * @notice removes a account from waived fee restriction.
     * can be called only from permissioned actor.
     * @param account user address
     */
    function removeWaivedFeeAccount(address account) external;

    /**
     * @notice set new reciever for fees.
     * can be called only from permissioned actor.
     * @param reciever new fee reciever address
     */
    function setFeeReceiver(address reciever) external;

    /**
     * @notice set new reciever for tokens.
     * can be called only from permissioned actor.
     * @param reciever new token reciever address
     */
    function setTokensReceiver(address reciever) external;

    /**
     * @notice set operation fee percent.
     * can be called only from permissioned actor.
     * @param newInstantFee new instant operations fee percent 1& = 100
     */
    function setInstantFee(uint256 newInstantFee) external;

    /**
     * @notice set operation daily limit.
     * can be called only from permissioned actor.
     * @param newInstantDailyLimit new operation daily limit (decimals 18)
     */
    function setInstantDailyLimit(uint256 newInstantDailyLimit) external;

    /**
     * @notice frees given `user` from the minimal deposit
     * amount validation in `initiateDepositRequest`
     * @param user address of user
     */
    function freeFromMinAmount(address user, bool enable) external;
}
