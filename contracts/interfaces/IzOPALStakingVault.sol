// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

/**
 * @notice Deposit record struct
 * @param depositor address of the depositor
 * @param amount original USDC amount deposited
 * @param depositTimestamp timestamp when deposit was made
 * @param lockExpiry timestamp when lock period expires
 * @param withdrawn whether deposit is fully consumed
 * @param remainingAmount remaining USDC not yet withdrawn
 * @param referrerId referrer identifier for tracking
 */
struct DepositRecord {
    address depositor;
    uint256 amount;
    uint256 depositTimestamp;
    uint256 lockExpiry;
    bool withdrawn;
    uint256 remainingAmount;
    bytes32 referrerId;
}

/**
 * @notice Withdrawal request status
 */
enum WithdrawalStatus {
    Pending,
    Approved,
    Rejected
}

/**
 * @notice Withdrawal request struct
 * @param user address of the user
 * @param requestedAmount total USDC amount requested
 * @param netAmount amount user will receive after penalties
 * @param totalPenalty total penalty amount
 * @param status request status
 * @param requestTimestamp when request was created
 */
struct WithdrawalRequest {
    address user;
    uint256 requestedAmount;
    uint256 netAmount;
    uint256 totalPenalty;
    WithdrawalStatus status;
    uint256 requestTimestamp;
}

/**
 * @title IzOPALStakingVault
 * @notice Interface for the zOPAL Staking Vault contract
 * @dev Users deposit USDC, which is converted to zOPAL and transferred to MPC wallet
 * Users earn Zocta Points off-chain. Early withdrawals incur penalties.
 * @author Zoth Protocol
 */
interface IzOPALStakingVault {
    // ========== EVENTS ==========

    /**
     * @param user depositor address
     * @param depositId unique deposit identifier
     * @param amount USDC amount deposited
     * @param lockExpiry timestamp when lock expires
     * @param referrerId referrer identifier
     */
    event Deposit(
        address indexed user,
        uint256 indexed depositId,
        uint256 amount,
        uint256 lockExpiry,
        bytes32 referrerId
    );

    /**
     * @param user withdrawer address
     * @param requestId withdrawal request ID
     * @param amount total USDC requested
     * @param netAmount amount after penalties
     * @param totalPenalty total penalty deducted
     */
    event WithdrawalRequested(
        address indexed user,
        uint256 indexed requestId,
        uint256 amount,
        uint256 netAmount,
        uint256 totalPenalty
    );

    /**
     * @param user withdrawer address
     * @param requestId withdrawal request ID
     * @param netAmount amount transferred to user
     * @param totalPenalty penalty transferred to fee receiver
     */
    event WithdrawalApproved(
        address indexed user,
        uint256 indexed requestId,
        uint256 netAmount,
        uint256 totalPenalty
    );

    /**
     * @param user withdrawer address
     * @param requestId withdrawal request ID
     */
    event WithdrawalRejected(
        address indexed user,
        uint256 indexed requestId
    );

    /**
     * @param user withdrawer address
     * @param depositId deposit that was consumed
     * @param consumedAmount amount consumed from this deposit
     * @param remainingAmount amount remaining in the deposit
     * @param penaltyApplied penalty applied to this consumption
     */
    event DepositConsumed(
        address indexed user,
        uint256 indexed depositId,
        uint256 consumedAmount,
        uint256 remainingAmount,
        uint256 penaltyApplied
    );

    /**
     * @param admin admin address
     * @param amount USDC amount added
     */
    event ReserveReplenished(address indexed admin, uint256 amount);

    /**
     * @param admin admin address
     * @param recipient recipient address
     * @param amount USDC amount removed
     */
    event USDCRemoved(address indexed admin, address indexed recipient, uint256 amount);

    /**
     * @param oldFee previous fee in basis points
     * @param newFee new fee in basis points
     */
    event EarlyWithdrawalFeeUpdated(uint256 oldFee, uint256 newFee);

    /**
     * @param oldMin previous minimum deposit
     * @param newMin new minimum deposit
     */
    event MinDepositUpdated(uint256 oldMin, uint256 newMin);

    /**
     * @param oldDuration previous lock duration
     * @param newDuration new lock duration
     */
    event LockDurationUpdated(uint256 oldDuration, uint256 newDuration);

    /**
     * @param oldWallet previous MPC wallet
     * @param newWallet new MPC wallet
     */
    event MpcWalletUpdated(address oldWallet, address newWallet);

    /**
     * @param oldReceiver previous fee receiver
     * @param newReceiver new fee receiver
     */
    event FeeReceiverUpdated(address oldReceiver, address newReceiver);

    /**
     * @param oldVault previous deposit vault
     * @param newVault new deposit vault
     */
    event DepositVaultUpdated(address oldVault, address newVault);

    // ========== USER FUNCTIONS ==========

    /**
     * @notice Deposit USDC into the staking vault
     * @dev USDC is converted to zOPAL via instantDeposit and sent to MPC wallet
     * @param amount USDC amount to deposit (6 decimals)
     * @param referrerId referrer identifier for tracking
     */
    function deposit(uint256 amount, bytes32 referrerId) external;

    /**
     * @notice Request withdrawal of USDC
     * @dev Creates a pending withdrawal request. Processes deposits in FIFO order,
     * expired deposits first (no penalty), then locked deposits (with penalty)
     * @param amount USDC amount to withdraw (6 decimals)
     * @return requestId the withdrawal request ID
     */
    function requestWithdrawal(uint256 amount) external returns (uint256 requestId);

    // ========== ADMIN FUNCTIONS ==========

    /**
     * @notice Approve a pending withdrawal request
     * @dev Transfers net amount to user and penalty to fee receiver
     * @param user user address
     * @param requestId withdrawal request ID
     */
    function approveWithdrawalRequest(address user, uint256 requestId) external;

    /**
     * @notice Reject a pending withdrawal request
     * @dev Restores user's deposit balances
     * @param user user address
     * @param requestId withdrawal request ID
     */
    function rejectWithdrawalRequest(address user, uint256 requestId) external;

    /**
     * @notice Add USDC to the contract for withdrawal funding
     * @param amount USDC amount to add (6 decimals)
     */
    function replenishReserve(uint256 amount) external;

    /**
     * @notice Remove USDC from contract
     * @param amount USDC amount to remove (6 decimals)
     * @param recipient address to receive USDC
     */
    function removeUSDC(uint256 amount, address recipient) external;

    /**
     * @notice Update lock duration for future deposits
     * @param newDuration new lock duration in seconds
     */
    function setLockDuration(uint256 newDuration) external;

    /**
     * @notice Update early withdrawal fee
     * @param newFee new fee in basis points (100 = 1%)
     */
    function setEarlyWithdrawalFee(uint256 newFee) external;

    /**
     * @notice Update minimum deposit amount
     * @param newMin new minimum in USDC (6 decimals)
     */
    function setMinDepositAmount(uint256 newMin) external;

    /**
     * @notice Update MPC wallet address
     * @param newWallet new MPC wallet address
     */
    function setMpcWalletAddress(address newWallet) external;

    /**
     * @notice Update fee receiver address
     * @param newReceiver new fee receiver address
     */
    function setFeeReceiver(address newReceiver) external;

    /**
     * @notice Update zOPAL deposit vault address
     * @param newVault new deposit vault address
     */
    function setDepositVault(address newVault) external;

    /**
     * @notice Pause the contract
     */
    function pause() external;

    /**
     * @notice Unpause the contract
     */
    function unpause() external;

    // ========== VIEW FUNCTIONS ==========

    /**
     * @notice Get deposit record by ID
     * @param depositId deposit ID
     * @return deposit record
     */
    function getDeposit(uint256 depositId) external view returns (DepositRecord memory);

    /**
     * @notice Get all deposit IDs for a user
     * @param user user address
     * @return array of deposit IDs
     */
    function getUserDeposits(address user) external view returns (uint256[] memory);

    /**
     * @notice Get number of deposits for a user
     * @param user user address
     * @return count of deposits
     */
    function getUserDepositCount(address user) external view returns (uint256);

    /**
     * @notice Get withdrawal request by user and ID
     * @param user user address
     * @param requestId request ID
     * @return withdrawal request
     */
    function getWithdrawalRequest(address user, uint256 requestId) external view returns (WithdrawalRequest memory);

    /**
     * @notice Get current USDC balance in contract
     * @return USDC balance
     */
    function getReserveBalance() external view returns (uint256);

    /**
     * @notice Get amount withdrawable without penalty
     * @param user user address
     * @return USDC amount from expired deposits
     */
    function getWithdrawableWithoutPenalty(address user) external view returns (uint256);

    /**
     * @notice Get total active deposited amount for user
     * @param user user address
     * @return total USDC across all non-withdrawn deposits
     */
    function getTotalDeposited(address user) external view returns (uint256);

    /**
     * @notice Get total locked amount for user
     * @param user user address
     * @return USDC still within lock period
     */
    function getLockedAmount(address user) external view returns (uint256);

    /**
     * @notice Estimate withdrawal result without executing
     * @param user user address
     * @param amount USDC amount to withdraw
     * @return netAmount amount user would receive
     * @return totalPenalty penalty that would apply
     */
    function estimateWithdrawal(address user, uint256 amount) 
        external view returns (uint256 netAmount, uint256 totalPenalty);
}
