// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {IERC20Upgradeable as IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {SafeERC20Upgradeable as SafeERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../access/Greenlistable.sol";
import "../access/Blacklistable.sol";
import "../abstract/WithSanctionsList.sol";
import "../interfaces/IzOPALStakingVault.sol";
import "../interfaces/IDepositVault.sol";
import "./zOPALStakingVaultRoles.sol";

/**
 * @title zOPALStakingVault
 * @notice Staking vault that accepts USDC deposits, locks capital for configurable duration,
 * and deploys USDC into zOPAL vaults. Users earn Zocta Points off-chain.
 * @dev Implements FIFO withdrawal with early withdrawal penalties
 * @author Zoth Protocol
 */
contract zOPALStakingVault is
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    Greenlistable,
    Blacklistable,
    WithSanctionsList,
    IzOPALStakingVault,
    zOPALStakingVaultRoles
{
    using SafeERC20 for IERC20;

    // ========== CONSTANTS ==========

    /// @notice Basis points denominator (100% = 10000)
    uint256 public constant BASIS_POINTS = 10000;

    /// @notice Default lock duration (180 days)
    uint256 public constant DEFAULT_LOCK_DURATION = 180 days;

    /// @notice Default early withdrawal fee (5% = 500 basis points)
    uint256 public constant DEFAULT_EARLY_WITHDRAWAL_FEE = 500;

    /// @notice Default minimum deposit (10 USDC = 10e6)
    uint256 public constant DEFAULT_MIN_DEPOSIT = 10e6;

    // ========== STATE VARIABLES ==========

    /// @notice USDC token address
    IERC20 public usdc;

    /// @notice zOPAL token address
    IERC20 public zOPAL;

    /// @notice zOPAL Deposit Vault address
    address public depositVault;

    /// @notice MPC wallet address for zOPAL custody
    address public mpcWalletAddress;

    /// @notice Fee receiver address for penalties
    address public feeReceiver;

    /// @notice Lock duration for new deposits (in seconds)
    uint256 public lockDuration;

    /// @notice Early withdrawal fee in basis points (500 = 5%)
    uint256 public earlyWithdrawalFee;

    /// @notice Minimum deposit amount in USDC (6 decimals)
    uint256 public minDepositAmount;

    /// @notice Greenlist enabled is inherited from Greenlistable
    /// greenlistEnabled is already defined in Greenlistable

    /// @notice Total USDC deposited by all users
    uint256 public totalDeposited;

    /// @notice Current deposit ID counter
    uint256 public currentDepositId;

    /// @notice Mapping from deposit ID to deposit record
    mapping(uint256 => DepositRecord) public deposits;

    /// @notice Mapping from user to array of their deposit IDs
    mapping(address => uint256[]) public userDeposits;

    /// @notice Mapping from user to their total deposited amount
    mapping(address => uint256) public userTotalDeposited;

    /// @notice Current withdrawal request ID counter per user
    mapping(address => uint256) public userWithdrawalRequestId;

    /// @notice Mapping from user to request ID to withdrawal request
    mapping(address => mapping(uint256 => WithdrawalRequest)) public withdrawalRequests;

    /// @notice Temporary storage for deposit consumptions during withdrawal request
    /// Maps user => requestId => depositId => consumed amount
    mapping(address => mapping(uint256 => mapping(uint256 => uint256))) private _requestConsumptions;

    /// @notice Storage gap for future upgrades
    uint256[40] private __gap;

    // ========== MODIFIERS ==========

    modifier onlyVaultAdmin() {
        _onlyRole(STAKING_VAULT_ADMIN_ROLE, msg.sender);
        _;
    }

    modifier onlyPauseOperator() {
        _onlyRole(STAKING_VAULT_PAUSE_OPERATOR_ROLE, msg.sender);
        _;
    }

    modifier validUser(address user) {
        _validateUserAccess(user);
        _;
    }

    // ========== INITIALIZER ==========

    /**
     * @notice Initialize the staking vault
     * @param _accessControl ZothAccessControl contract address
     * @param _usdc USDC token address
     * @param _zOPAL zOPAL token address
     * @param _depositVault zOPAL Deposit Vault address
     * @param _mpcWalletAddress MPC wallet for zOPAL custody
     * @param _feeReceiver address to receive penalty fees
     * @param _sanctionsList Chainalysis sanctions oracle address
     */
    function initialize(
        address _accessControl,
        address _usdc,
        address _zOPAL,
        address _depositVault,
        address _mpcWalletAddress,
        address _feeReceiver,
        address _sanctionsList
    ) external initializer {
        require(_accessControl != address(0), "SV: zero access control");
        require(_usdc != address(0), "SV: zero usdc");
        require(_zOPAL != address(0), "SV: zero zOPAL");
        require(_depositVault != address(0), "SV: zero deposit vault");
        require(_mpcWalletAddress != address(0), "SV: zero mpc wallet");
        require(_feeReceiver != address(0), "SV: zero fee receiver");

        __ReentrancyGuard_init();
        __Pausable_init();
        __Greenlistable_init(_accessControl);
        __Blacklistable_init_unchained();
        __WithSanctionsList_init_unchained(_sanctionsList);

        usdc = IERC20(_usdc);
        zOPAL = IERC20(_zOPAL);
        depositVault = _depositVault;
        mpcWalletAddress = _mpcWalletAddress;
        feeReceiver = _feeReceiver;

        lockDuration = DEFAULT_LOCK_DURATION;
        earlyWithdrawalFee = DEFAULT_EARLY_WITHDRAWAL_FEE;
        minDepositAmount = DEFAULT_MIN_DEPOSIT;
        greenlistEnabled = true;
    }

    // ========== USER FUNCTIONS ==========

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function deposit(
        uint256 amount,
        bytes32 referrerId
    ) external nonReentrant whenNotPaused validUser(msg.sender) {
        require(amount >= minDepositAmount, "SV: amount < min deposit");

        address user = msg.sender;

        // Transfer USDC from user to this contract
        usdc.safeTransferFrom(user, address(this), amount);

        // Create deposit record
        uint256 depositId = currentDepositId++;
        uint256 lockExpiry = block.timestamp + lockDuration;

        deposits[depositId] = DepositRecord({
            depositor: user,
            amount: amount,
            depositTimestamp: block.timestamp,
            lockExpiry: lockExpiry,
            withdrawn: false,
            remainingAmount: amount,
            referrerId: referrerId
        });

        userDeposits[user].push(depositId);
        userTotalDeposited[user] += amount;
        totalDeposited += amount;

        // Approve USDC to deposit vault
        usdc.safeApprove(depositVault, amount);

        // Deposit into zOPAL vault via instantDeposit
        // Using 0 for minReceiveAmount as we're not concerned with slippage for staking
        IDepositVault(depositVault).depositInstant(
            address(usdc),
            amount,
            0,
            referrerId,
            mpcWalletAddress
        );

        emit Deposit(user, depositId, amount, lockExpiry, referrerId);
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function requestWithdrawal(
        uint256 amount
    ) external nonReentrant whenNotPaused validUser(msg.sender) returns (uint256 requestId) {
        address user = msg.sender;
        require(amount > 0, "SV: zero amount");
        require(userTotalDeposited[user] >= amount, "SV: insufficient balance");

        requestId = userWithdrawalRequestId[user]++;

        // Calculate withdrawal using FIFO logic
        (uint256 netAmount, uint256 totalPenalty) = _processWithdrawalCalculation(user, amount, requestId);

        withdrawalRequests[user][requestId] = WithdrawalRequest({
            user: user,
            requestedAmount: amount,
            netAmount: netAmount,
            totalPenalty: totalPenalty,
            status: WithdrawalStatus.Pending,
            requestTimestamp: block.timestamp
        });

        emit WithdrawalRequested(user, requestId, amount, netAmount, totalPenalty);
    }

    // ========== ADMIN FUNCTIONS ==========

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function approveWithdrawalRequest(
        address user,
        uint256 requestId
    ) external onlyVaultAdmin nonReentrant {
        WithdrawalRequest storage request = withdrawalRequests[user][requestId];
        require(request.user != address(0), "SV: request not exist");
        require(request.status == WithdrawalStatus.Pending, "SV: not pending");

        uint256 totalRequired = request.netAmount + request.totalPenalty;
        require(usdc.balanceOf(address(this)) >= totalRequired, "SV: insufficient reserve");

        request.status = WithdrawalStatus.Approved;

        // Apply the consumption to deposits
        _applyWithdrawalConsumptions(user, requestId, request.requestedAmount);

        // Transfer USDC to user
        if (request.netAmount > 0) {
            usdc.safeTransfer(user, request.netAmount);
        }

        // Transfer penalty to fee receiver
        if (request.totalPenalty > 0) {
            usdc.safeTransfer(feeReceiver, request.totalPenalty);
        }

        emit WithdrawalApproved(user, requestId, request.netAmount, request.totalPenalty);
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function rejectWithdrawalRequest(
        address user,
        uint256 requestId
    ) external onlyVaultAdmin {
        WithdrawalRequest storage request = withdrawalRequests[user][requestId];
        require(request.user != address(0), "SV: request not exist");
        require(request.status == WithdrawalStatus.Pending, "SV: not pending");

        request.status = WithdrawalStatus.Rejected;

        // Clear the stored consumptions (don't apply them)
        _clearRequestConsumptions(user, requestId);

        emit WithdrawalRejected(user, requestId);
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function replenishReserve(uint256 amount) external onlyVaultAdmin {
        require(amount > 0, "SV: zero amount");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit ReserveReplenished(msg.sender, amount);
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function removeUSDC(uint256 amount, address recipient) external onlyVaultAdmin {
        require(amount > 0, "SV: zero amount");
        require(recipient != address(0), "SV: zero recipient");
        require(usdc.balanceOf(address(this)) >= amount, "SV: insufficient balance");

        usdc.safeTransfer(recipient, amount);
        emit USDCRemoved(msg.sender, recipient, amount);
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function setLockDuration(uint256 newDuration) external onlyVaultAdmin {
        uint256 oldDuration = lockDuration;
        lockDuration = newDuration;
        emit LockDurationUpdated(oldDuration, newDuration);
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function setEarlyWithdrawalFee(uint256 newFee) external onlyVaultAdmin {
        require(newFee <= BASIS_POINTS, "SV: fee > 100%");
        uint256 oldFee = earlyWithdrawalFee;
        earlyWithdrawalFee = newFee;
        emit EarlyWithdrawalFeeUpdated(oldFee, newFee);
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function setMinDepositAmount(uint256 newMin) external onlyVaultAdmin {
        uint256 oldMin = minDepositAmount;
        minDepositAmount = newMin;
        emit MinDepositUpdated(oldMin, newMin);
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function setMpcWalletAddress(address newWallet) external onlyVaultAdmin {
        require(newWallet != address(0), "SV: zero address");
        address oldWallet = mpcWalletAddress;
        mpcWalletAddress = newWallet;
        emit MpcWalletUpdated(oldWallet, newWallet);
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function setFeeReceiver(address newReceiver) external onlyVaultAdmin {
        require(newReceiver != address(0), "SV: zero address");
        address oldReceiver = feeReceiver;
        feeReceiver = newReceiver;
        emit FeeReceiverUpdated(oldReceiver, newReceiver);
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function setDepositVault(address newVault) external onlyVaultAdmin {
        require(newVault != address(0), "SV: zero address");
        address oldVault = depositVault;
        depositVault = newVault;
        emit DepositVaultUpdated(oldVault, newVault);
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function pause() external onlyPauseOperator {
        _pause();
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function unpause() external onlyPauseOperator {
        _unpause();
    }

    // ========== VIEW FUNCTIONS ==========

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function getDeposit(uint256 depositId) external view returns (DepositRecord memory) {
        return deposits[depositId];
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function getUserDeposits(address user) external view returns (uint256[] memory) {
        return userDeposits[user];
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function getUserDepositCount(address user) external view returns (uint256) {
        return userDeposits[user].length;
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function getWithdrawalRequest(
        address user,
        uint256 requestId
    ) external view returns (WithdrawalRequest memory) {
        return withdrawalRequests[user][requestId];
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function getReserveBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function getWithdrawableWithoutPenalty(address user) external view returns (uint256) {
        uint256 withdrawable = 0;
        uint256[] memory depositIds = userDeposits[user];

        for (uint256 i = 0; i < depositIds.length; i++) {
            DepositRecord storage dep = deposits[depositIds[i]];
            if (!dep.withdrawn && dep.remainingAmount > 0 && dep.lockExpiry <= block.timestamp) {
                withdrawable += dep.remainingAmount;
            }
        }

        return withdrawable;
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function getTotalDeposited(address user) external view returns (uint256) {
        return userTotalDeposited[user];
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function getLockedAmount(address user) external view returns (uint256) {
        uint256 locked = 0;
        uint256[] memory depositIds = userDeposits[user];

        for (uint256 i = 0; i < depositIds.length; i++) {
            DepositRecord storage dep = deposits[depositIds[i]];
            if (!dep.withdrawn && dep.remainingAmount > 0 && dep.lockExpiry > block.timestamp) {
                locked += dep.remainingAmount;
            }
        }

        return locked;
    }

    /**
     * @inheritdoc IzOPALStakingVault
     */
    function estimateWithdrawal(
        address user,
        uint256 amount
    ) external view returns (uint256 netAmount, uint256 totalPenalty) {
        if (amount == 0 || userTotalDeposited[user] < amount) {
            return (0, 0);
        }

        return _calculateWithdrawal(user, amount);
    }

    // ========== INTERNAL FUNCTIONS ==========

    /**
     * @dev Validate user access (greenlist, blacklist, sanctions)
     */
    function _validateUserAccess(address user) internal view {
        if (greenlistEnabled) {
            require(
                accessControl.hasRole(GREENLISTED_ROLE, user),
                "SV: not greenlisted"
            );
        }
        require(
            !accessControl.hasRole(BLACKLISTED_ROLE, user),
            "SV: blacklisted"
        );
        if (sanctionsList != address(0)) {
            require(
                !ISanctionsList(sanctionsList).isSanctioned(user),
                "SV: sanctioned"
            );
        }
    }

    /**
     * @dev Calculate withdrawal amounts using FIFO logic (view only)
     */
    function _calculateWithdrawal(
        address user,
        uint256 amount
    ) internal view returns (uint256 netAmount, uint256 totalPenalty) {
        uint256[] memory depositIds = userDeposits[user];
        uint256 remaining = amount;
        uint256 expiredConsumed = 0;
        uint256 lockedConsumed = 0;
        uint256 penalty = 0;

        // Phase 1: Consume expired deposits (no penalty)
        for (uint256 i = 0; i < depositIds.length && remaining > 0; i++) {
            DepositRecord storage dep = deposits[depositIds[i]];
            if (dep.withdrawn || dep.remainingAmount == 0) continue;
            if (dep.lockExpiry > block.timestamp) continue; // Not expired

            uint256 toConsume = remaining > dep.remainingAmount ? dep.remainingAmount : remaining;
            expiredConsumed += toConsume;
            remaining -= toConsume;
        }

        // Phase 2: Consume locked deposits (with penalty)
        for (uint256 i = 0; i < depositIds.length && remaining > 0; i++) {
            DepositRecord storage dep = deposits[depositIds[i]];
            if (dep.withdrawn || dep.remainingAmount == 0) continue;
            if (dep.lockExpiry <= block.timestamp) continue; // Already processed as expired

            uint256 toConsume = remaining > dep.remainingAmount ? dep.remainingAmount : remaining;
            lockedConsumed += toConsume;
            penalty += (toConsume * earlyWithdrawalFee) / BASIS_POINTS;
            remaining -= toConsume;
        }

        netAmount = expiredConsumed + lockedConsumed - penalty;
        totalPenalty = penalty;
    }

    /**
     * @dev Process withdrawal calculation and store consumptions for later application
     */
    function _processWithdrawalCalculation(
        address user,
        uint256 amount,
        uint256 requestId
    ) internal returns (uint256 netAmount, uint256 totalPenalty) {
        uint256[] memory depositIds = userDeposits[user];
        uint256 remaining = amount;
        uint256 expiredConsumed = 0;
        uint256 lockedConsumed = 0;
        uint256 penalty = 0;

        // Phase 1: Consume expired deposits (no penalty)
        for (uint256 i = 0; i < depositIds.length && remaining > 0; i++) {
            DepositRecord storage dep = deposits[depositIds[i]];
            if (dep.withdrawn || dep.remainingAmount == 0) continue;
            if (dep.lockExpiry > block.timestamp) continue;

            uint256 toConsume = remaining > dep.remainingAmount ? dep.remainingAmount : remaining;
            expiredConsumed += toConsume;
            remaining -= toConsume;

            // Store consumption for later application
            _requestConsumptions[user][requestId][depositIds[i]] = toConsume;
        }

        // Phase 2: Consume locked deposits (with penalty)
        for (uint256 i = 0; i < depositIds.length && remaining > 0; i++) {
            DepositRecord storage dep = deposits[depositIds[i]];
            if (dep.withdrawn || dep.remainingAmount == 0) continue;
            if (dep.lockExpiry <= block.timestamp) continue;

            uint256 toConsume = remaining > dep.remainingAmount ? dep.remainingAmount : remaining;
            lockedConsumed += toConsume;
            penalty += (toConsume * earlyWithdrawalFee) / BASIS_POINTS;
            remaining -= toConsume;

            // Store consumption for later application
            _requestConsumptions[user][requestId][depositIds[i]] = toConsume;
        }

        netAmount = expiredConsumed + lockedConsumed - penalty;
        totalPenalty = penalty;
    }

    /**
     * @dev Apply stored withdrawal consumptions to deposits
     */
    function _applyWithdrawalConsumptions(
        address user,
        uint256 requestId,
        uint256 /* amount */
    ) internal {
        uint256[] memory depositIds = userDeposits[user];
        uint256 totalConsumed = 0;

        for (uint256 i = 0; i < depositIds.length; i++) {
            uint256 depositId = depositIds[i];
            uint256 consumption = _requestConsumptions[user][requestId][depositId];

            if (consumption > 0) {
                DepositRecord storage dep = deposits[depositId];
                bool isLocked = dep.lockExpiry > block.timestamp;
                uint256 penaltyForThis = isLocked ? (consumption * earlyWithdrawalFee) / BASIS_POINTS : 0;

                dep.remainingAmount -= consumption;
                if (dep.remainingAmount == 0) {
                    dep.withdrawn = true;
                }

                totalConsumed += consumption;

                emit DepositConsumed(
                    user,
                    depositId,
                    consumption,
                    dep.remainingAmount,
                    penaltyForThis
                );

                // Clear the consumption
                delete _requestConsumptions[user][requestId][depositId];
            }
        }

        // Update user and total deposited
        userTotalDeposited[user] -= totalConsumed;
        totalDeposited -= totalConsumed;
    }

    /**
     * @dev Clear stored consumptions without applying them (for rejected requests)
     */
    function _clearRequestConsumptions(address user, uint256 requestId) internal {
        uint256[] memory depositIds = userDeposits[user];
        for (uint256 i = 0; i < depositIds.length; i++) {
            delete _requestConsumptions[user][requestId][depositIds[i]];
        }
    }

    // ========== ACCESS CONTROL OVERRIDES ==========

    /**
     * @inheritdoc WithSanctionsList
     */
    function sanctionsListAdminRole() public pure override returns (bytes32) {
        return STAKING_VAULT_ADMIN_ROLE;
    }

    /**
     * @inheritdoc Greenlistable
     */
    function greenlistTogglerRole() public pure override returns (bytes32) {
        return STAKING_VAULT_ADMIN_ROLE;
    }
}
