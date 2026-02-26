// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./access/WithFunctionsAccessControl.sol";
import "./interfaces/IDataFeed.sol";

/**
 * @title PriceOracle
 * @notice A price oracle contract with tolerance checking and base18 conversion
 * @dev Allows authorized price admins to update prices with deviation protection
 * @dev Implements IDataFeed interface for compatibility with vault contracts
 */
contract PriceOracle is WithFunctionsAccessControl, IDataFeed {
    // Price data
    uint256 public currentPrice; // Price in base18 format
    uint256 public lastUpdateTimestamp;
    uint8 public priceDecimals; // Decimals of the input price
    uint256 public tolerancePercent; // Tolerance percentage in basis points (e.g., 1000 = 10%)
    uint256 public maxStaleness; // Maximum age of price in seconds before it's considered stale (0 = disabled)

    // Events
    event PriceUpdated(
        uint256 indexed oldPrice,
        uint256 indexed newPrice,
        uint256 timestamp,
        address indexed updatedBy
    );
    event ToleranceUpdated(uint256 oldTolerance, uint256 newTolerance);
    event PriceDecimalsUpdated(uint8 oldDecimals, uint8 newDecimals);
    event MaxStalenessUpdated(uint256 oldMaxStaleness, uint256 newMaxStaleness);

    // Errors
    error ToleranceExceeded(
        uint256 oldPrice,
        uint256 newPrice,
        uint256 deviation
    );
    error InvalidPrice();
    error InvalidDecimals();
    error StalePrice(uint256 lastUpdate, uint256 currentTime, uint256 maxAge);
    error PriceNotSet();

    /**
     * @notice Constructor
     * @param _accessControl Address of the FunctionsAccessControl contract
     * @param _priceDecimals Initial decimals for price input
     * @param _tolerancePercent Initial tolerance in basis points
     * @param _maxStaleness Maximum age of price in seconds (0 = disabled)
     */
    constructor(
        address _accessControl,
        uint8 _priceDecimals,
        uint256 _tolerancePercent,
        uint256 _maxStaleness
    ) {
        _initializeAccessControl(_accessControl);
        require(_priceDecimals <= 18, "Decimals too high");
        require(_tolerancePercent <= 10000, "Tolerance cannot exceed 100%");

        priceDecimals = _priceDecimals;
        tolerancePercent = _tolerancePercent;
        maxStaleness = _maxStaleness;
    }

    /**
     * @dev converts `originalAmount` with `originalDecimals` into amount with `decidedDecimals`
     * @param originalAmount amount to convert
     * @param originalDecimals decimals of the original amount
     * @param decidedDecimals decimals for the output amount
     * @return amount converted amount with `decidedDecimals`
     */
    function _convert(
        uint256 originalAmount,
        uint256 originalDecimals,
        uint256 decidedDecimals
    ) internal pure returns (uint256) {
        if (originalAmount == 0) return 0;
        if (originalDecimals == decidedDecimals) return originalAmount;

        uint256 adjustedAmount;

        if (originalDecimals > decidedDecimals) {
            adjustedAmount =
                originalAmount /
                (10 ** (originalDecimals - decidedDecimals));
        } else {
            adjustedAmount =
                originalAmount *
                (10 ** (decidedDecimals - originalDecimals));
        }

        return adjustedAmount;
    }

    /**
     * @dev converts `originalAmount` with `originalDecimals` into amount with decimals 18
     * @param originalAmount amount to convert
     * @param originalDecimals decimals of the original amount
     * @return amount converted amount with 18 decimals
     */
    function _convertToBase18(
        uint256 originalAmount,
        uint256 originalDecimals
    ) internal pure returns (uint256) {
        return _convert(originalAmount, originalDecimals, 18);
    }

    /**
     * @notice Set the price with tolerance check
     * @param _price The new price in the configured decimals
     * @dev Only accounts with PRICE_ADMIN_ROLE can call this
     */
    function setPrice(
        uint256 _price
    ) external onlyRole(accessControl.PRICE_ADMIN_ROLE()) {
        if (_price == 0) revert InvalidPrice();

        // Convert input price to base18
        uint256 newPriceBase18 = _convertToBase18(_price, priceDecimals);

        // Check tolerance if there's a previous price and tolerance is set
        if (currentPrice > 0 && tolerancePercent > 0) {
            // Calculate percentage deviation in basis points
            uint256 deviation;
            if (newPriceBase18 > currentPrice) {
                deviation =
                    ((newPriceBase18 - currentPrice) * 10000) /
                    currentPrice;
            } else {
                deviation =
                    ((currentPrice - newPriceBase18) * 10000) /
                    currentPrice;
            }

            // Revert if deviation exceeds tolerance
            if (deviation > tolerancePercent) {
                revert ToleranceExceeded(
                    currentPrice,
                    newPriceBase18,
                    deviation
                );
            }
        }

        uint256 oldPrice = currentPrice;
        currentPrice = newPriceBase18;
        lastUpdateTimestamp = block.timestamp;

        emit PriceUpdated(
            oldPrice,
            newPriceBase18,
            block.timestamp,
            msg.sender
        );
    }

    /**
     * @notice Set the tolerance percentage for price deviation
     * @param _tolerancePercent Tolerance in basis points (e.g., 1000 = 10%, 500 = 5%)
     * @dev Only accounts with CONFIG_ROLE can call this
     */
    function setTolerancePercent(
        uint256 _tolerancePercent
    ) external onlyRole(accessControl.CONFIG_ROLE()) {
        require(_tolerancePercent <= 10000, "Tolerance cannot exceed 100%");
        uint256 oldTolerance = tolerancePercent;
        tolerancePercent = _tolerancePercent;
        emit ToleranceUpdated(oldTolerance, _tolerancePercent);
    }

    /**
     * @notice Set the decimals of the input price
     * @param _decimals The number of decimals in the input price (e.g., 8 for USD prices)
     * @dev Only accounts with CONFIG_ROLE can call this
     */
    function setPriceDecimals(
        uint8 _decimals
    ) external onlyRole(accessControl.CONFIG_ROLE()) {
        if (_decimals > 18) revert InvalidDecimals();
        uint8 oldDecimals = priceDecimals;
        priceDecimals = _decimals;
        emit PriceDecimalsUpdated(oldDecimals, _decimals);
    }

    /**
     * @notice Set the maximum staleness for price data
     * @param _maxStaleness Maximum age of price in seconds (0 = disabled)
     * @dev Only accounts with CONFIG_ROLE can call this
     */
    function setMaxStaleness(
        uint256 _maxStaleness
    ) external onlyRole(accessControl.CONFIG_ROLE()) {
        uint256 oldMaxStaleness = maxStaleness;
        maxStaleness = _maxStaleness;
        emit MaxStalenessUpdated(oldMaxStaleness, _maxStaleness);
    }

    /**
     * @notice Get the current price in base18 format
     * @dev Reverts if price is stale (when maxStaleness > 0)
     * @return price The current price with 18 decimals
     */
    function getDataInBase18() external view override returns (uint256) {
        // Check if price has ever been set
        if (lastUpdateTimestamp == 0) revert PriceNotSet();

        // Check staleness if maxStaleness is configured (> 0)
        if (maxStaleness > 0) {
            uint256 priceAge = block.timestamp - lastUpdateTimestamp;
            if (priceAge > maxStaleness) {
                revert StalePrice(
                    lastUpdateTimestamp,
                    block.timestamp,
                    maxStaleness
                );
            }
        }

        return currentPrice;
    }

    /**
     * @notice Returns the role responsible for managing prices in this contract
     * @return role The PRICE_ADMIN_ROLE from the access control contract
     * @dev Implements IDataFeed.feedAdminRole() for interface compliance
     */
    function feedAdminRole() external view override returns (bytes32) {
        return accessControl.PRICE_ADMIN_ROLE();
    }

    /**
     * @notice Returns the timestamp of the last price update
     * @return timestamp of the last update
     * @dev Implements IDataFeed.getLastUpdateTimestamp() for interface compliance
     */
    function getLastUpdateTimestamp() external view override returns (uint256) {
        return lastUpdateTimestamp;
    }

    /**
     * @notice Get the current price in a specific decimal format
     * @param decimals The desired number of decimals
     * @return price The current price converted to the specified decimals
     */
    function getPrice(uint8 decimals) external view returns (uint256) {
        if (decimals > 18) revert InvalidDecimals();
        return _convert(currentPrice, 18, decimals);
    }

    /**
     * @notice Get price age in seconds
     * @return age Time since last price update in seconds
     */
    function getPriceAge() external view returns (uint256) {
        if (lastUpdateTimestamp == 0) return 0;
        return block.timestamp - lastUpdateTimestamp;
    }

    /**
     * @notice Check if price is stale
     * @param maxAge Maximum acceptable age in seconds
     * @return isStale True if price is older than maxAge
     */
    function isPriceStale(uint256 maxAge) external view returns (bool) {
        if (lastUpdateTimestamp == 0) return true;
        return (block.timestamp - lastUpdateTimestamp) > maxAge;
    }
}
