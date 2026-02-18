// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./IManageableVaultRedeem.sol";
import "./IVaultShared.sol";

/**
 * @notice Redeem request scruct
 * @param sender user address who create
 * @param tokenOut tokenOut address
 * @param status request status
 * @param amountZToken amount zToken
 * @param zTokenRate rate of zToken at request creation time
 * @param tokenOutRate rate of tokenOut at request creation time
 */
struct Request {
    address sender;
    address tokenOut;
    RequestStatus status;
    uint256 amountZToken;
    uint256 zTokenRate;
    uint256 tokenOutRate;
}

struct FiatRedeptionInitParams {
    uint256 fiatAdditionalFee;
    uint256 fiatFlatFee;
    uint256 minFiatRedeemAmount;
}

/**
 * @title IRedemptionVault
 * @author RedDuck Software
 */
interface IRedemptionVault is IManageableVaultRedeem {
    /**
     * @param user function caller (msg.sender)
     * @param tokenOut address of tokenOut
     * @param amount amount of zToken
     * @param feeAmount fee amount in zToken
     * @param amountTokenOut amount of tokenOut
     */
    event RedeemInstant(
        address indexed user,
        address indexed tokenOut,
        uint256 amount,
        uint256 feeAmount,
        uint256 amountTokenOut
    );

    /**
     * @param requestId request id
     * @param user function caller (msg.sender)
     * @param tokenOut address of tokenOut
     * @param amountZTokenIn amount of zToken
     */
    event RedeemRequest(
        uint256 indexed requestId,
        address indexed user,
        address indexed tokenOut,
        uint256 amountZTokenIn,
        uint256 feeAmount
    );

    /**
     * @param requestId mint request id
     * @param newZTokenRate net zToken rate
     */
    event ApproveRequest(uint256 indexed requestId, uint256 newZTokenRate);

    /**
     * @param requestId mint request id
     * @param newZTokenRate net zToken rate
     */
    event SafeApproveRequest(uint256 indexed requestId, uint256 newZTokenRate);

    /**
     * @param requestId mint request id
     * @param user address of user
     */
    event RejectRequest(uint256 indexed requestId, address indexed user);

    /**
     * @param caller function caller (msg.sender)
     * @param newMinAmount new min amount for fiat requests
     */
    event SetMinFiatRedeemAmount(address indexed caller, uint256 newMinAmount);

    /**
     * @param caller function caller (msg.sender)
     * @param feeInZToken fee amount in zToken
     */
    event SetFiatFlatFee(address indexed caller, uint256 feeInZToken);

    /**
     * @param caller function caller (msg.sender)
     * @param newfee new fiat fee percent 1% = 100
     */
    event SetFiatAdditionalFee(address indexed caller, uint256 newfee);

    /**
     * @param caller function caller (msg.sender)
     * @param redeemer new address of request redeemer
     */
    event SetRequestRedeemer(address indexed caller, address redeemer);

    /**
     * @notice redeem zToken to tokenOut if daily limit and allowance not exceeded
     * Burns zToken from the user.
     * Transfers fee in zToken to feeReceiver
     * Transfers tokenOut to user.
     * @param tokenOut stable coin token address to redeem to
     * @param amountZTokenIn amount of zToken to redeem (decimals 18)
     * @param minReceiveAmount minimum expected amount of tokenOut to receive (native token decimals, e.g., 6 for USDC)
     */
    function redeemInstant(
        address tokenOut,
        uint256 amountZTokenIn,
        uint256 minReceiveAmount
    ) external;

    /**
     * @notice creating redeem request if tokenOut not fiat
     * Transfers amount in zToken to contract
     * Transfers fee in zToken to feeReceiver
     * @param tokenOut stable coin token address to redeem to
     * @param amountZTokenIn amount of zToken to redeem (decimals 18)
     * @return request id
     */
    function redeemRequest(
        address tokenOut,
        uint256 amountZTokenIn
    ) external returns (uint256);

    /**
     * @notice creating redeem request if tokenOut is fiat
     * Transfers amount in zToken to contract
     * Transfers fee in zToken to feeReceiver
     * @param amountZTokenIn amount of zToken to redeem (decimals 18)
     * @return request id
     */
    function redeemFiatRequest(
        uint256 amountZTokenIn
    ) external returns (uint256);

    /**
     * @notice approving redeem request if not exceed tokenOut allowance
     * Burns amount zToken from contract
     * Transfers tokenOut to user
     * Sets flag Processed
     * @param requestId request id
     * @param newZTokenRate new zToken rate inputted by vault admin
     */
    function approveRequest(uint256 requestId, uint256 newZTokenRate) external;

    /**
     * @notice approving request if inputted token rate fit price diviation percent
     * Burns amount zToken from contract
     * Transfers tokenOut to user
     * Sets flag Processed
     * @param requestId request id
     * @param newZTokenRate new zToken rate inputted by vault admin
     */
    function safeApproveRequest(
        uint256 requestId,
        uint256 newZTokenRate
    ) external;

    /**
     * @notice rejecting request
     * Sets request flag to Canceled.
     * @param requestId request id
     */
    function rejectRequest(uint256 requestId) external;

    /**
     * @notice set new min amount for fiat requests
     * @param newValue new min amount
     */
    function setMinFiatRedeemAmount(uint256 newValue) external;

    /**
     * @notice set fee amount in zToken for fiat requests
     * @param feeInZToken fee amount in zToken
     */
    function setFiatFlatFee(uint256 feeInZToken) external;

    /**
     * @notice set new fee percent for fiat requests
     * @param newFee new fee percent 1% = 100
     */
    function setFiatAdditionalFee(uint256 newFee) external;

    /**
     * @notice set address which is designated for standard redemptions, allowing tokens to be pulled from this address
     * @param redeemer new address of request redeemer
     */
    function setRequestRedeemer(address redeemer) external;
}
