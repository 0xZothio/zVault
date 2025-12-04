// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

/**
 * @title IVaultShared
 * @notice Shared types and events used across vault interfaces
 * @author RedDuck Software
 */

/**
 * @param dataFeed data feed token/USD address
 * @param fee fee by token, 1% = 100
 * @param allowance token allowance (decimals 18)
 */
struct TokenConfig {
    address dataFeed;
    uint256 fee;
    uint256 allowance;
    bool stable;
}

enum RequestStatus {
    Pending,
    Processed,
    Canceled
}

struct ZTokenInitParams {
    address zToken;
    address zTokenDataFeed;
}

struct ReceiversInitParams {
    address tokensReceiver;
    address feeReceiver;
}

struct InstantInitParams {
    uint256 instantFee;
    uint256 instantDailyLimit;
}

/**
 * @title IVaultSharedEvents
 * @notice Shared events interface for vault contracts
 */
interface IVaultSharedEvents {
    /**
     * @param caller function caller (msg.sender)
     * @param token token that was withdrawn
     * @param withdrawTo address to which tokens were withdrawn
     * @param amount `token` transfer amount
     */
    event WithdrawToken(
        address indexed caller,
        address indexed token,
        address indexed withdrawTo,
        uint256 amount
    );

    /**
     * @param token address of token that
     * @param caller function caller (msg.sender)
     * @param allowance new allowance
     */
    event ChangeTokenAllowance(
        address indexed token,
        address indexed caller,
        uint256 allowance
    );

    /**
     * @param token address of token that
     * @param caller function caller (msg.sender)
     * @param fee new fee
     */
    event ChangeTokenFee(
        address indexed token,
        address indexed caller,
        uint256 fee
    );

    /**
     * @param token address of token that
     * @param caller function caller (msg.sender)
     */
    event RemovePaymentToken(address indexed token, address indexed caller);

    /**
     * @param account address of account
     * @param caller function caller (msg.sender)
     */
    event AddWaivedFeeAccount(address indexed account, address indexed caller);

    /**
     * @param account address of account
     * @param caller function caller (msg.sender)
     */
    event RemoveWaivedFeeAccount(
        address indexed account,
        address indexed caller
    );

    /**
     * @param caller function caller (msg.sender)
     * @param newFee new operation fee value
     */
    event SetInstantFee(address indexed caller, uint256 newFee);

    /**
     * @param caller function caller (msg.sender)
     * @param newAmount new min amount for operation
     */
    event SetMinAmount(address indexed caller, uint256 newAmount);

    /**
     * @param caller function caller (msg.sender)
     * @param newLimit new operation daily limit
     */
    event SetInstantDailyLimit(address indexed caller, uint256 newLimit);

    /**
     * @param caller function caller (msg.sender)
     * @param newTolerance percent of price diviation 1% = 100
     */
    event SetVariationTolerance(address indexed caller, uint256 newTolerance);

    /**
     * @param caller function caller (msg.sender)
     * @param reciever new reciever address
     */
    event SetFeeReceiver(address indexed caller, address indexed reciever);

    /**
     * @param caller function caller (msg.sender)
     * @param reciever new reciever address
     */
    event SetTokensReceiver(address indexed caller, address indexed reciever);

    /**
     * @param user user address
     * @param enable is enabled
     */
    event FreeFromMinAmount(address indexed user, bool enable);

    /**
     * @param caller function caller (msg.sender)
     * @param token address of token that
     * @param dataFeed token dataFeed address
     * @param fee fee 1% = 100
     * @param allowance token allowance (decimals 18)
     * @param stable stablecoin flag
     */
    event AddPaymentToken(
        address indexed caller,
        address indexed token,
        address indexed dataFeed,
        uint256 fee,
        uint256 allowance,
        bool stable
    );
}
