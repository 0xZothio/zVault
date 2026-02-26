// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import {IERC20Upgradeable as IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {IERC20MetadataUpgradeable as IERC20Metadata} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";

import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";

import "./interfaces/IRedemptionVault.sol";
import "./interfaces/IZToken.sol";
import "./interfaces/IDataFeed.sol";

import "./abstract/ManageableVaultRedeem.sol";

import "./access/Greenlistable.sol";
import "./libraries/DecimalsCorrectionLibrary.sol";

/**
 * @title RedemptionVault
 * @notice Smart contract that handles zToken redemptions
 * @author RedDuck Software
 */
contract RedemptionVault is ManageableVaultRedeem, IRedemptionVault {
    using Counters for Counters.Counter;
    using DecimalsCorrectionLibrary for uint256;

    /**
     * @notice min amount for fiat requests
     */
    uint256 public minFiatRedeemAmount;

    /**
     * @notice fee percent for fiat requests
     */
    uint256 public fiatAdditionalFee;

    /**
     * @notice static fee in zToken for fiat requests
     */
    uint256 public fiatFlatFee;

    /**
     * @notice mapping, requestId to request data
     */
    mapping(uint256 => Request) public redeemRequests;

    /**
     * @notice address is designated for standard redemptions, allowing tokens to be pulled from this address
     */
    address public requestRedeemer;

    /**
     * @dev leaving a storage gap for futures updates
     */
    uint256[50] private __gap;

    /**
     * @notice upgradeable pattern contract`s initializer
     * @param _ac address of ZothAccessControl contract
     * @param _zTokenInitParams init params for zToken
     * @param _receiversInitParams init params for receivers
     * @param _instantInitParams init params for instant operations
     * @param _sanctionsList address of sanctionsList contract
     * @param _variationTolerance percent of prices diviation 1% = 100
     * @param _minAmount basic min amount for operations
     * @param _fiatRedemptionInitParams params fiatAdditionalFee, fiatFlatFee, minFiatRedeemAmount
     * @param _requestRedeemer address is designated for standard redemptions, allowing tokens to be pulled from this address
     */
    function initialize(
        address _ac,
        ZTokenInitParams calldata _zTokenInitParams,
        ReceiversInitParams calldata _receiversInitParams,
        InstantInitParams calldata _instantInitParams,
        address _sanctionsList,
        uint256 _variationTolerance,
        uint256 _minAmount,
        FiatRedeptionInitParams calldata _fiatRedemptionInitParams,
        address _requestRedeemer
    ) external initializer {
        __RedemptionVault_init(
            _ac,
            _zTokenInitParams,
            _receiversInitParams,
            _instantInitParams,
            _sanctionsList,
            _variationTolerance,
            _minAmount,
            _fiatRedemptionInitParams,
            _requestRedeemer
        );
    }

    // solhint-disable func-name-mixedcase
    function __RedemptionVault_init(
        address _ac,
        ZTokenInitParams calldata _zTokenInitParams,
        ReceiversInitParams calldata _receiversInitParams,
        InstantInitParams calldata _instantInitParams,
        address _sanctionsList,
        uint256 _variationTolerance,
        uint256 _minAmount,
        FiatRedeptionInitParams calldata _fiatRedemptionInitParams,
        address _requestRedeemer
    ) internal onlyInitializing {
        __ManageableVaultRedeem_init(
            _ac,
            _zTokenInitParams,
            _receiversInitParams,
            _instantInitParams,
            _sanctionsList,
            _variationTolerance,
            _minAmount
        );
        _validateFee(_fiatRedemptionInitParams.fiatAdditionalFee, false);
        _validateAddress(_requestRedeemer, false);

        minFiatRedeemAmount = _fiatRedemptionInitParams.minFiatRedeemAmount;
        fiatAdditionalFee = _fiatRedemptionInitParams.fiatAdditionalFee;
        fiatFlatFee = _fiatRedemptionInitParams.fiatFlatFee;
        requestRedeemer = _requestRedeemer;
    }

    /**
     * @inheritdoc IRedemptionVault
     */
    function redeemInstant(
        address tokenOut,
        uint256 amountZTokenIn,
        uint256 minReceiveAmount
    )
        external
        virtual
        whenFnNotPaused(this.redeemInstant.selector)
        onlyGreenlisted(msg.sender)
        onlyNotBlacklisted(msg.sender)
        onlyNotSanctioned(msg.sender)
    {
        _redeemInstantInternal(tokenOut, amountZTokenIn, minReceiveAmount);
    }

    /**
     * @dev Internal implementation of redeemInstant to avoid stack too deep
     */
    function _redeemInstantInternal(
        address tokenOut,
        uint256 amountZTokenIn,
        uint256 minReceiveAmount
    ) internal {
        address user = msg.sender;
        uint256 tokenDecimals = _tokenDecimals(tokenOut);

        (
            uint256 feeAmount,
            uint256 amountZTokenWithoutFee
        ) = _calcAndValidateRedeem(user, tokenOut, amountZTokenIn, true, false);

        _requireAndUpdateLimit(amountZTokenIn);

        (uint256 amountZTokenInUsd, uint256 zTokenRate) = _convertZTokenToUsd(
            amountZTokenIn
        );
        (, uint256 tokenOutRate) = _convertUsdToToken(
            amountZTokenInUsd,
            tokenOut
        );

        uint256 amountTokenOutWithoutFee = _truncate(
            (amountZTokenWithoutFee * zTokenRate) / tokenOutRate,
            tokenDecimals
        );

        uint256 amountTokenOutNative = amountTokenOutWithoutFee
            .convertFromBase18(tokenDecimals);
        require(
            amountTokenOutNative >= minReceiveAmount,
            "RV: minReceiveAmount > actual"
        );

        _requireAndUpdateAllowance(tokenOut, amountTokenOutWithoutFee);

        zToken.burn(user, amountZTokenWithoutFee);
        if (feeAmount > 0)
            _tokenTransferFromUser(address(zToken), feeReceiver, feeAmount, 18);

        _tokenTransferToUser(
            tokenOut,
            user,
            amountTokenOutWithoutFee,
            tokenDecimals
        );

        emit RedeemInstant(
            user,
            tokenOut,
            amountZTokenIn,
            feeAmount,
            amountTokenOutNative
        );
    }

    /**
     * @inheritdoc IRedemptionVault
     */
    function redeemRequest(
        address tokenOut,
        uint256 amountZTokenIn
    )
        external
        whenFnNotPaused(this.redeemRequest.selector)
        onlyGreenlisted(msg.sender)
        onlyNotBlacklisted(msg.sender)
        onlyNotSanctioned(msg.sender)
        returns (uint256 requestId)
    {
        require(tokenOut != MANUAL_FULLFILMENT_TOKEN, "RV: tokenOut == fiat");
        return _redeemRequest(tokenOut, amountZTokenIn);
    }

    /**
     * @inheritdoc IRedemptionVault
     */
    function redeemFiatRequest(
        uint256 amountZTokenIn
    )
        external
        whenFnNotPaused(this.redeemFiatRequest.selector)
        onlyAlwaysGreenlisted(msg.sender)
        onlyNotBlacklisted(msg.sender)
        onlyNotSanctioned(msg.sender)
        returns (uint256 requestId)
    {
        return _redeemRequest(MANUAL_FULLFILMENT_TOKEN, amountZTokenIn);
    }

    /**
     * @inheritdoc IRedemptionVault
     */
    function approveRequest(
        uint256 requestId,
        uint256 newZTokenRate
    ) external onlyVaultAdmin {
        _approveRequest(requestId, newZTokenRate, false);

        emit ApproveRequest(requestId, newZTokenRate);
    }

    /**
     * @inheritdoc IRedemptionVault
     */
    function safeApproveRequest(
        uint256 requestId,
        uint256 newZTokenRate
    ) external onlyVaultAdmin {
        _approveRequest(requestId, newZTokenRate, true);

        emit SafeApproveRequest(requestId, newZTokenRate);
    }

    /**
     * @inheritdoc IRedemptionVault
     */
    function rejectRequest(uint256 requestId) external onlyVaultAdmin {
        Request memory request = redeemRequests[requestId];

        _validateRequest(request.sender, request.status);

        redeemRequests[requestId].status = RequestStatus.Canceled;

        emit RejectRequest(requestId, request.sender);
    }

    /**
     * @inheritdoc IRedemptionVault
     */
    function setMinFiatRedeemAmount(uint256 newValue) external onlyVaultAdmin {
        minFiatRedeemAmount = newValue;

        emit SetMinFiatRedeemAmount(msg.sender, newValue);
    }

    /**
     * @inheritdoc IRedemptionVault
     */
    function setFiatFlatFee(uint256 feeInZToken) external onlyVaultAdmin {
        fiatFlatFee = feeInZToken;

        emit SetFiatFlatFee(msg.sender, feeInZToken);
    }

    /**
     * @inheritdoc IRedemptionVault
     */
    function setFiatAdditionalFee(uint256 newFee) external onlyVaultAdmin {
        _validateFee(newFee, false);

        fiatAdditionalFee = newFee;

        emit SetFiatAdditionalFee(msg.sender, newFee);
    }

    /**
     * @inheritdoc IRedemptionVault
     */
    function setRequestRedeemer(address redeemer) external onlyVaultAdmin {
        _validateAddress(redeemer, false);

        requestRedeemer = redeemer;

        emit SetRequestRedeemer(msg.sender, redeemer);
    }

    /**
     * @inheritdoc ManageableVaultRedeem
     */
    function vaultRole() public pure virtual override returns (bytes32) {
        return REDEMPTION_VAULT_ADMIN_ROLE;
    }

    /**
     * @inheritdoc Greenlistable
     */
    function greenlistTogglerRole()
        public
        view
        virtual
        override
        returns (bytes32)
    {
        return vaultRole();
    }

    /**
     * @notice validates approve
     * burns amount from contract
     * transfer tokenOut to user if not fiat
     * sets flag Processed
     * @param requestId request id
     * @param newZTokenRate new zToken rate
     * @param isSafe new zToken rate
     */
    function _approveRequest(
        uint256 requestId,
        uint256 newZTokenRate,
        bool isSafe
    ) internal {
        Request memory request = redeemRequests[requestId];

        _validateRequest(request.sender, request.status);

        if (isSafe) {
            _requireVariationTolerance(request.zTokenRate, newZTokenRate);
        }

        zToken.burn(address(this), request.amountZToken);

        bool isFiat = request.tokenOut == MANUAL_FULLFILMENT_TOKEN;

        uint256 tokenDecimals = isFiat ? 18 : _tokenDecimals(request.tokenOut);

        uint256 amountTokenOutWithoutFee = _truncate(
            (request.amountZToken * newZTokenRate) / request.tokenOutRate,
            tokenDecimals
        );

        _requireAndUpdateAllowance(request.tokenOut, amountTokenOutWithoutFee);

        if (!isFiat) {
            _tokenTransferFromTo(
                request.tokenOut,
                requestRedeemer,
                request.sender,
                amountTokenOutWithoutFee,
                tokenDecimals
            );
        }

        request.status = RequestStatus.Processed;
        request.zTokenRate = newZTokenRate;
        redeemRequests[requestId] = request;
    }

    /**
     * @notice validates request
     * if exist
     * if not processed
     * @param sender sender address
     * @param status request status
     */
    function _validateRequest(
        address sender,
        RequestStatus status
    ) internal pure {
        require(sender != address(0), "RV: request not exist");
        require(status == RequestStatus.Pending, "RV: request not pending");
    }

    /**
     * @notice Creating request depends on tokenOut
     * @param tokenOut tokenOut address
     * @param amountZTokenIn amount of zToken (decimals 18)
     *
     * @return requestId request id
     */
    function _redeemRequest(
        address tokenOut,
        uint256 amountZTokenIn
    ) internal returns (uint256) {
        address user = msg.sender;

        bool isFiat = tokenOut == MANUAL_FULLFILMENT_TOKEN;

        (
            uint256 feeAmount,
            uint256 amountZTokenWithoutFee
        ) = _calcAndValidateRedeem(
                user,
                tokenOut,
                amountZTokenIn,
                false,
                isFiat
            );

        address tokenOutCopy = tokenOut;

        // assigning the default value which is gonna be used
        // only for fiat redemptions
        uint256 tokenOutRate = 1e18;

        if (!isFiat) {
            TokenConfig storage config = tokensConfig[tokenOutCopy];
            tokenOutRate = _getTokenRate(config.dataFeed, config.stable);
        }

        uint256 amountZTokenInCopy = amountZTokenIn;

        uint256 zTokenRate = zTokenDataFeed.getDataInBase18();

        _tokenTransferFromUser(
            address(zToken),
            address(this),
            amountZTokenWithoutFee,
            18 // zToken always have 18 decimals
        );
        if (feeAmount > 0)
            _tokenTransferFromUser(address(zToken), feeReceiver, feeAmount, 18);

        uint256 requestId = currentRequestId.current();
        currentRequestId.increment();

        redeemRequests[requestId] = Request({
            sender: user,
            tokenOut: tokenOutCopy,
            status: RequestStatus.Pending,
            amountZToken: amountZTokenWithoutFee,
            zTokenRate: zTokenRate,
            tokenOutRate: tokenOutRate
        });

        emit RedeemRequest(
            requestId,
            user,
            tokenOutCopy,
            amountZTokenInCopy,
            feeAmount
        );

        return requestId;
    }

    /**
     * @dev calculates tokenOut amount from USD amount
     * @param amountUsd amount of USD (decimals 18)
     * @param tokenOut tokenOut address
     *
     * @return amountToken converted USD to tokenOut
     * @return tokenRate conversion rate
     */
    function _convertUsdToToken(
        uint256 amountUsd,
        address tokenOut
    ) internal view returns (uint256 amountToken, uint256 tokenRate) {
        require(amountUsd > 0, "RV: amount zero");

        TokenConfig storage tokenConfig = tokensConfig[tokenOut];

        tokenRate = _getTokenRate(tokenConfig.dataFeed, tokenConfig.stable);
        require(tokenRate > 0, "RV: rate zero");

        amountToken = (amountUsd * (10 ** 18)) / tokenRate;
    }

    /**
     * @dev calculates USD amount from zToken amount
     * @param amountZToken amount of zToken (decimals 18)
     *
     * @return amountUsd converted amount to USD
     * @return zTokenRate conversion rate
     */
    function _convertZTokenToUsd(
        uint256 amountZToken
    ) internal view returns (uint256 amountUsd, uint256 zTokenRate) {
        require(amountZToken > 0, "RV: amount zero");

        zTokenRate = _getTokenRate(address(zTokenDataFeed), false);
        require(zTokenRate > 0, "RV: rate zero");

        amountUsd = (amountZToken * zTokenRate) / (10 ** 18);
    }

    /**
     * @dev validate redeem and calculate fee
     * @param user user address
     * @param tokenOut tokenOut address
     * @param amountZTokenIn zToken amount (decimals 18)
     * @param isInstant is instant operation
     * @param isFiat is fiat operation
     *
     * @return feeAmount fee amount in zToken
     * @return amountZTokenWithoutFee zToken amount without fee
     */
    function _calcAndValidateRedeem(
        address user,
        address tokenOut,
        uint256 amountZTokenIn,
        bool isInstant,
        bool isFiat
    )
        internal
        view
        returns (uint256 feeAmount, uint256 amountZTokenWithoutFee)
    {
        require(amountZTokenIn > 0, "RV: invalid amount");

        if (!isFreeFromMinAmount[user]) {
            uint256 minRedeemAmount = isFiat ? minFiatRedeemAmount : minAmount;
            require(minRedeemAmount <= amountZTokenIn, "RV: amount < min");
        }

        feeAmount = _getFeeAmount(
            user,
            tokenOut,
            amountZTokenIn,
            isInstant,
            isFiat ? fiatAdditionalFee : 0
        );

        if (isFiat) {
            require(
                tokenOut == MANUAL_FULLFILMENT_TOKEN,
                "RV: tokenOut != fiat"
            );
            if (!waivedFeeRestriction[user]) feeAmount += fiatFlatFee;
        } else {
            _requireTokenExists(tokenOut);
        }

        require(amountZTokenIn > feeAmount, "RV: amountZTokenIn < fee");

        amountZTokenWithoutFee = amountZTokenIn - feeAmount;
    }
}
