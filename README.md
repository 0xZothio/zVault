# zVault Protocol

A tokenized vault system for the ZeUSD token, enabling users to deposit stablecoins and receive ZeUSD tokens, as well as redeem ZeUSD tokens back for underlying assets.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Contracts](#contracts)
- [Getting Started](#getting-started)
- [Testing](#testing)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [Security](#security)
- [License](#license)

---

## Overview

zVault is a DeFi protocol that provides:

- **Deposit Functionality**: Users deposit stablecoins (USDC, USDT, etc.) and receive ZeUSD tokens
- **Redemption Functionality**: Users burn ZeUSD tokens to receive underlying stablecoins
- **Price Oracle**: Configurable price feed with tolerance checks for fair pricing
- **Access Control**: Role-based permission system for secure operations
- **Greenlist/Blacklist**: KYC/AML compliance through address filtering
- **Sanctions Compliance**: Integration with Chainalysis sanctions oracle

### Key Features

| Feature | Description |
|---------|-------------|
| Upgradeable Contracts | ERC1967 proxy pattern for upgradeability |
| Multi-Token Support | Accept multiple stablecoins as payment |
| Instant & Request Flows | Both instant minting and request-based flows |
| Fee System | Configurable instant fees and token-specific fees |
| Daily Limits | Configurable daily limits for instant operations |
| Price Tolerance | Protection against price manipulation |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           zVault Architecture                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌─────────────────┐                    ┌─────────────────────────┐    │
│   │ ZothAccessCtrl │◄───────────────────│   FunctionsAccessCtrl   │    │
│   │  (Vault Roles)  │                    │    (Oracle Roles)       │    │
│   └────────┬────────┘                    └───────────┬─────────────┘    │
│            │                                         │                   │
│            ▼                                         ▼                   │
│   ┌─────────────────┐         ┌─────────────────────────────────┐       │
│   │   ZeUSD Token   │◄────────│         PriceOracle             │       │
│   │  (ERC20+Pause)  │         │  (Tolerance + Decimal Convert)  │       │
│   └────────┬────────┘         └─────────────────────────────────┘       │
│            │                              ▲           ▲                  │
│            │                              │           │                  │
│   ┌────────┴────────────────────┬─────────┴───────────┴─────────┐       │
│   │                             │                               │       │
│   ▼                             ▼                               ▼       │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────┐  │
│  │  DepositVault   │    │ RedemptionVault │    │ ZeUSDDepositVault   │  │
│  │  (Base Logic)   │    │  (Burn Logic)   │    │ (ZeUSD-specific)    │  │
│  └─────────────────┘    └─────────────────┘    └─────────────────────┘  │
│           ▲                      ▲                                       │
│           │                      │                                       │
│           └──────────────────────┴──────────────────────────────────────│
│                                                                          │
│                        ┌─────────────────────┐                          │
│                        │   ManageableVault   │                          │
│                        │ (Shared Vault Base) │                          │
│                        └─────────────────────┘                          │
│                                  │                                       │
│                   ┌──────────────┼──────────────┐                       │
│                   ▼              ▼              ▼                       │
│            ┌──────────┐  ┌──────────────┐  ┌────────────┐               │
│            │Greenlist │  │  Blacklist   │  │ Sanctions  │               │
│            └──────────┘  └──────────────┘  └────────────┘               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Contracts

### Core Contracts

| Contract | Description | Location |
|----------|-------------|----------|
| `DepositVault.sol` | Handles deposits and mints ZeUSD tokens | `contracts/DepositVault.sol` |
| `RedemptionVault.sol` | Handles redemptions and burns ZeUSD tokens | `contracts/RedemptionVault.sol` |
| `PriceOracle.sol` | Price feed with tolerance checks and decimal conversion | `contracts/PriceOracle.sol` |

### Token Contracts

| Contract | Description | Location |
|----------|-------------|----------|
| `ZeUSD.sol` | ERC20 token with mint, burn, pause, and blacklist | `contracts/ZeUSD/ZeUSD.sol` |
| `ZeUSDDepositVault.sol` | ZeUSD-specific deposit vault | `contracts/ZeUSD/ZeUSDDepositVault.sol` |

### Access Control

| Contract | Description | Location |
|----------|-------------|----------|
| `ZothAccessControl.sol` | Role-based access control for vaults | `contracts/access/ZothAccessControl.sol` |
| `FunctionsAccessControl.sol` | Role-based access for oracle operations | `contracts/access/FunctionsAccessControl.sol` |
| `Blacklistable.sol` | Blacklist functionality | `contracts/access/Blacklistable.sol` |
| `Greenlistable.sol` | Greenlist/whitelist functionality | `contracts/access/Greenlistable.sol` |
| `Pausable.sol` | Pause functionality with per-function granularity | `contracts/access/Pausable.sol` |

### Abstract Contracts

| Contract | Description | Location |
|----------|-------------|----------|
| `ManageableVault.sol` | Base vault with token management, fees, limits | `contracts/abstract/ManageableVault.sol` |
| `ManageableVaultRedeem.sol` | Base redemption vault functionality | `contracts/abstract/ManageableVaultRedeem.sol` |
| `WithSanctionsList.sol` | Chainalysis sanctions integration | `contracts/abstract/WithSanctionsList.sol` |
| `ZothInitializable.sol` | Base initializable for upgradeable contracts | `contracts/abstract/ZothInitializable.sol` |

### Libraries

| Contract | Description | Location |
|----------|-------------|----------|
| `DecimalsCorrectionLibrary.sol` | Decimal conversion utilities (base18) | `contracts/libraries/DecimalsCorrectionLibrary.sol` |

### Interfaces

| Interface | Description |
|-----------|-------------|
| `IDepositVault.sol` | Deposit vault interface |
| `IRedemptionVault.sol` | Redemption vault interface |
| `IManageableVault.sol` | Base vault interface |
| `IZToken.sol` | ZeUSD token interface |
| `IDataFeed.sol` | Price feed interface |
| `IVaultShared.sol` | Shared types and events |

---

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0 (or npm/yarn)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd zVault

# Install dependencies
pnpm install

# Compile contracts
pnpm compile
```

### Environment Setup

Create a `.env` file in the root directory:

```env
# Deployer private key (without 0x prefix)
DEPLOYER_ACCOUNT_PRIV_KEY=your_private_key_here

# API keys for verification
POLYGONSCAN_API_KEY=your_polygonscan_api_key

# Tenderly (optional)
TENDERLY_KEY=your_tenderly_key
```

---

## Testing

### Running Tests

```bash
# Run all tests
pnpm test

# Run specific test file
npx hardhat test test/PriceOracle.test.ts

# Run with gas reporting
REPORT_GAS=true pnpm test

# Run with coverage
npx hardhat coverage
```

### Test Structure

```
test/
└── PriceOracle.test.ts    # Price oracle test suite
```

### Test Coverage

The `PriceOracle.test.ts` includes comprehensive tests for:

| Category | Tests |
|----------|-------|
| **Deployment** | Initial parameters, decimal validation, tolerance validation |
| **Price Updates** | Initial price, zero price rejection, unauthorized access, tolerance checks |
| **Decimal Conversion** | 6/8/18 decimal conversions, getPrice function |
| **Tolerance Configuration** | Update tolerance, validation, unauthorized access |
| **Price Decimals Config** | Update decimals, validation, usage in updates |
| **Price Age & Staleness** | Age calculation, staleness detection |
| **Edge Cases** | Small/large values, multiple updates, zero conversion |
| **Tolerance Calculation** | Small changes, large deviations, different decimals |

### Writing New Tests

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("ContractName", function () {
    async function deployFixture() {
        const [deployer] = await ethers.getSigners();
        // Deploy contracts
        return { contract, deployer };
    }

    beforeEach(async function () {
        const fixture = await loadFixture(deployFixture);
        // Set up test state
    });

    describe("Feature", function () {
        it("Should do something", async function () {
            // Test implementation
        });
    });
});
```

---

## Deployment

### Deployment Scripts

Scripts are located in the `deploy/` directory and execute in order:

| Order | Script | Tag | Description |
|-------|--------|-----|-------------|
| 00 | `00-deploy-access-control.ts` | `ZothAccessControl` | Deploys access control contract |
| 01 | `01-deploy-zeusd-token.ts` | `ZeUSD` | Deploys ZeUSD token |
| 02 | `02-deploy-price-oracle.ts` | `PriceOracle` | Deploys price oracle |
| 03 | `03-deploy-zeusd-deposit-vault.ts` | `ZeUSDDepositVault` | Deploys deposit vault |
| 04 | `04-deploy-zeusd-redemption-vault.ts` | `RedemptionVault` | Deploys redemption vault |
| 05 | `05-deploy-all.ts` | `Complete` | Orchestrates full deployment |

### NPM Scripts

```bash
# Deploy to local hardhat network
pnpm deploy:local

# Deploy to Polygon Amoy testnet
pnpm deploy:amoy

# Deploy to Polygon mainnet
pnpm deploy:mainnet

# Deploy specific contracts
pnpm deploy:access-control   # Only ZothAccessControl
pnpm deploy:zeusd           # Only ZeUSD token
pnpm deploy:oracle          # Only PriceOracle
pnpm deploy:deposit-vault   # Only ZeUSDDepositVault
pnpm deploy:redemption-vault # Only RedemptionVault
pnpm deploy:all             # Full deployment with orchestration

# Start local node
pnpm node

# Clean artifacts
pnpm clean
```

### Deployment Order

```
ZothAccessControl
       │
       ▼
     ZeUSD ─────────────────┐
       │                    │
       ▼                    │
  PriceOracle ──────────────┤
       │                    │
       ▼                    ▼
ZeUSDDepositVault     RedemptionVault
```

---

## Configuration

### Deployment Configuration

Create `config/deployment.json` based on `config/deployment.example.json`:

```json
{
  "network": {
    "name": "amoy",
    "chainId": 80002
  },
  "contracts": {
    "ZeUSD": {
      "name": "ZeUSD",
      "symbol": "ZeUSD"
    },
    "priceOracle": {
      "initialPrice": "100000000",
      "priceDecimals": 8,
      "tolerancePercent": 500
    },
    "depositVault": {
      "minZTokenAmountForFirstDeposit": "100000000000000000000",
      "maxSupplyCap": "1000000000000000000000000",
      "minAmount": "1000000000000000000",
      "variationTolerance": 300,
      "instantFee": 50,
      "instantDailyLimit": "100000000000000000000000"
    }
  }
}
```

See `config/DEPLOYMENT_CONFIG_README.md` for detailed configuration documentation.

---

## Roles

### ZothAccessControl Roles

| Role | Description |
|------|-------------|
| `DEFAULT_ADMIN_ROLE` | Can manage all other roles |
| `DEPOSIT_VAULT_ADMIN_ROLE` | Admin of deposit vault operations |
| `REDEMPTION_VAULT_ADMIN_ROLE` | Admin of redemption vault operations |
| `GREENLIST_OPERATOR_ROLE` | Can add/remove from greenlist |
| `BLACKLIST_OPERATOR_ROLE` | Can add/remove from blacklist |
| `ZEUSD_MINT_OPERATOR_ROLE` | Can mint ZeUSD tokens |
| `ZEUSD_BURN_OPERATOR_ROLE` | Can burn ZeUSD tokens |
| `ZEUSD_PAUSE_OPERATOR_ROLE` | Can pause/unpause ZeUSD token |

### FunctionsAccessControl Roles

| Role | Description |
|------|-------------|
| `ADMIN_ROLE` | General admin role |
| `REQUESTER_ROLE` | Can request Chainlink functions |
| `CONFIG_ROLE` | Can configure oracle parameters |
| `PRICE_ADMIN_ROLE` | Can update prices |

### ZeUSD Roles

| Role | Description |
|------|-------------|
| `ZEUSD_MINT_OPERATOR_ROLE` | Can mint ZeUSD |
| `ZEUSD_BURN_OPERATOR_ROLE` | Can burn ZeUSD |
| `ZEUSD_PAUSE_OPERATOR_ROLE` | Can pause/unpause ZeUSD |

---

## Security

### Audit Reports

- **Full Audit Report**: [`SECURITY_AUDIT_REPORT.md`](./SECURITY_AUDIT_REPORT.md)
- **Audit Summary**: [`AUDIT_SUMMARY.md`](./AUDIT_SUMMARY.md)

### Exploit POCs

Educational exploit proofs-of-concept are available in the `exploits/` directory:

| Exploit | Vulnerability |
|---------|---------------|
| `PriceManipulationExploit.sol` | Price Oracle Tolerance Bypass |
| `PrecisionLossExploit.sol` | Precision Loss in Decimal Conversions |
| `WithdrawTokenExploit.sol` | Missing Balance Validation |

See [`exploits/README.md`](./exploits/README.md) for details.

### Security Considerations

1. **Multi-Sig**: Use multi-sig wallets for all admin roles
2. **Timelocks**: Implement timelocks for sensitive operations
3. **Price Staleness**: Monitor oracle for stale prices
4. **Role Separation**: Use different keys for different roles
5. **Emergency Pause**: Test pause functionality before mainnet

---

## Project Structure

```
zVault/
├── contracts/              # Solidity smart contracts
│   ├── abstract/          # Abstract base contracts
│   ├── access/            # Access control contracts
│   ├── interfaces/        # Contract interfaces
│   ├── libraries/         # Utility libraries
│   ├── utils/            # Utility contracts (proxy)
│   ├── ZeUSD/            # ZeUSD-specific contracts
│   ├── DepositVault.sol
│   ├── RedemptionVault.sol
│   └── PriceOracle.sol
├── deploy/                # Deployment scripts
├── test/                  # Test files
├── exploits/              # Security exploit POCs
├── config/                # Configuration files
├── utils/                 # TypeScript utilities
├── services/              # Service classes
├── typechain-types/       # Generated TypeScript types
├── artifacts/             # Compiled contract artifacts
├── hardhat.config.ts      # Hardhat configuration
├── package.json           # Dependencies
└── README.md             # This file
```

---

## Networks

| Network | Chain ID | RPC URL |
|---------|----------|---------|
| Hardhat (local) | 31337 | `http://127.0.0.1:8545` |
| Polygon Amoy | 80002 | `https://rpc-amoy.polygon.technology` |
| Polygon Mainnet | 137 | `https://polygon-mainnet.g.alchemy.com/v2/...` |

---

## Dependencies

### Production

| Package | Version | Description |
|---------|---------|-------------|
| `@openzeppelin/contracts` | 4.9 | OpenZeppelin contracts |
| `@openzeppelin/contracts-upgradeable` | 4.9 | Upgradeable contracts |
| `@chainlink/local` | ^0.2.1 | Chainlink local testing |
| `dotenv` | ^17.2.2 | Environment variables |

### Development

| Package | Version | Description |
|---------|---------|-------------|
| `hardhat` | ^2.26.5 | Development environment |
| `hardhat-deploy` | ^0.12.4 | Deployment management |
| `@nomicfoundation/hardhat-toolbox` | ^6.0.0 | Hardhat utilities |
| `ethers` | ^6.4.0 | Ethereum library |
| `chai` | ^4.2.0 | Assertion library |
| `typescript` | >=4.5.0 | TypeScript support |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

ISC License

---

## Support

For questions and support, please open an issue on GitHub.

