# zVault Protocol

A tokenized vault system for the zOPAL token, enabling users to deposit stablecoins and receive zOPAL tokens, redeem zOPAL tokens back for underlying assets, and stake USDC to earn Zocta Points.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Contracts](#contracts)
- [Staking Vault](#staking-vault)
- [Timelock Upgrades](#timelock-upgrades)
- [Getting Started](#getting-started)
- [Testing](#testing)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [Security](#security)
- [License](#license)

---

## Overview

zVault is a DeFi protocol that provides:

- **Deposit Functionality**: Users deposit stablecoins (USDC, USDT, etc.) and receive zOPAL tokens
- **Redemption Functionality**: Users burn zOPAL tokens to receive underlying stablecoins
- **Staking Vault**: Users stake USDC with configurable lock periods, earning Zocta Points off-chain
- **Price Oracle**: Configurable price feed with tolerance checks for fair pricing
- **Access Control**: Role-based permission system for secure operations
- **Greenlist/Blacklist**: KYC/AML compliance through address filtering
- **Sanctions Compliance**: Integration with Chainalysis sanctions oracle
- **Timelock Upgrades**: TimelockController-gated contract upgrades with multi-sig support

### Key Features

| Feature | Description |
|---------|-------------|
| Upgradeable Contracts | TransparentUpgradeableProxy pattern for upgradeability |
| Multi-Token Support | Accept multiple stablecoins as payment |
| Instant & Request Flows | Both instant minting and request-based flows |
| Fee System | Configurable instant fees and token-specific fees |
| Daily Limits | Configurable daily limits for instant operations |
| Price Tolerance | Protection against price manipulation |
| USDC Staking | Lock USDC for configurable duration, earn Zocta Points |
| FIFO Withdrawals | First-in-first-out withdrawal with early exit penalties |
| Timelock Upgrades | Schedule/execute upgrades with mandatory delay period |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            zVault Architecture                               │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────┐                    ┌─────────────────────────┐         │
│   │ ZothAccessCtrl │◄───────────────────│   FunctionsAccessCtrl   │         │
│   │  (Vault Roles)  │                    │    (Oracle Roles)       │         │
│   └────────┬────────┘                    └───────────┬─────────────┘         │
│            │                                         │                       │
│            ▼                                         ▼                       │
│   ┌─────────────────┐         ┌─────────────────────────────────┐            │
│   │   zOPAL Token   │◄────────│         PriceOracle             │            │
│   │  (ERC20+Pause)  │         │  (Tolerance + Decimal Convert)  │            │
│   └────────┬────────┘         └─────────────────────────────────┘            │
│            │                              ▲           ▲                       │
│            │                              │           │                       │
│   ┌────────┴──────────────┬───────────────┴───────────┴──────────┐           │
│   │                       │                                      │           │
│   ▼                       ▼                                      ▼           │
│  ┌─────────────────┐  ┌─────────────────┐   ┌─────────────────────────┐     │
│  │  DepositVault   │  │ RedemptionVault │   │   zOPALDepositVault     │     │
│  │  (Base Logic)   │  │  (Burn Logic)   │   │   (zOPAL-specific)      │     │
│  └─────────────────┘  └─────────────────┘   └───────────┬─────────────┘     │
│           ▲                    ▲                         │                    │
│           │                    │                         ▼                    │
│           └────────────────────┤           ┌─────────────────────────┐       │
│                                │           │  zOPALStakingVault      │       │
│                                │           │  (USDC Lock + Points)   │       │
│                                │           └─────────────────────────┘       │
│                                │                                             │
│                   ┌────────────┴────────────────┐                            │
│                   │      ManageableVault        │                            │
│                   │    (Shared Vault Base)       │                            │
│                   └──────┬──────┬──────┬────────┘                            │
│                          ▼      ▼      ▼                                     │
│                   ┌──────────┐ ┌────────────┐ ┌────────────┐                 │
│                   │Greenlist │ │ Blacklist  │ │ Sanctions  │                 │
│                   └──────────┘ └────────────┘ └────────────┘                 │
│                                                                              │
│   ┌──────────────────────────────────────────────────────────┐               │
│   │                    Upgrade Infrastructure                 │               │
│   │   ┌────────────────┐    ┌──────────────────────────┐     │               │
│   │   │  ProxyAdmin    │◄───│   UpgradeTimelock        │     │               │
│   │   │ (Owns Proxies) │    │ (Schedule + Delay + Exec)│     │               │
│   │   └────────────────┘    └──────────────────────────┘     │               │
│   └──────────────────────────────────────────────────────────┘               │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Contracts

### Core Contracts

| Contract | Description | Location |
|----------|-------------|----------|
| `DepositVault.sol` | Handles deposits and mints zOPAL tokens | `contracts/DepositVault.sol` |
| `RedemptionVault.sol` | Handles redemptions and burns zOPAL tokens | `contracts/RedemptionVault.sol` |
| `PriceOracle.sol` | Price feed with tolerance checks and decimal conversion | `contracts/PriceOracle.sol` |

### Token Contracts

| Contract | Description | Location |
|----------|-------------|----------|
| `zOPAL.sol` | ERC20 token with mint, burn, pause, and blacklist | `contracts/zOPAL/zOPAL.sol` |
| `zOPALDepositVault.sol` | zOPAL-specific deposit vault | `contracts/zOPAL/zOPALDepositVault.sol` |
| `zOPALStakingVault.sol` | USDC staking vault with lock periods and FIFO withdrawals | `contracts/zOPAL/zOPALStakingVault.sol` |
| `zOPALStakingVaultRoles.sol` | Role definitions for staking vault | `contracts/zOPAL/zOPALStakingVaultRoles.sol` |

### Access Control

| Contract | Description | Location |
|----------|-------------|----------|
| `ZothAccessControl.sol` | Role-based access control for vaults | `contracts/access/ZothAccessControl.sol` |
| `FunctionsAccessControl.sol` | Role-based access for oracle operations | `contracts/access/FunctionsAccessControl.sol` |
| `Blacklistable.sol` | Blacklist functionality | `contracts/access/Blacklistable.sol` |
| `Greenlistable.sol` | Greenlist/whitelist functionality | `contracts/access/Greenlistable.sol` |
| `Pausable.sol` | Pause functionality with per-function granularity | `contracts/access/Pausable.sol` |

### Utility Contracts

| Contract | Description | Location |
|----------|-------------|----------|
| `UpgradeTimelock.sol` | TimelockController for gated contract upgrades | `contracts/utils/UpgradeTimelock.sol` |
| `TransparentUpgradeableProxy.sol` | Proxy for upgradeable contracts | `contracts/utils/TransparentUpgradeableProxy.sol` |

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
| `IZToken.sol` | zOPAL token interface |
| `IDataFeed.sol` | Price feed interface |
| `IVaultShared.sol` | Shared types and events |
| `IzOPALStakingVault.sol` | Staking vault interface with deposit/withdrawal structs |

---

## Staking Vault

The `zOPALStakingVault` allows users to deposit USDC, which is converted to zOPAL via the deposit vault and transferred to an MPC wallet. Users earn **Zocta Points** off-chain during the lock period.

### How It Works

1. **Deposit**: User deposits USDC (min 10 USDC). The vault calls `instantDeposit` on the zOPAL Deposit Vault, converting USDC to zOPAL, which is sent to the MPC wallet.
2. **Lock Period**: Deposits are locked for a configurable duration (default 180 days). Each deposit is tracked individually with its own lock expiry.
3. **Withdrawal Request**: User requests a withdrawal amount. The vault processes deposits in FIFO order — expired deposits first (no penalty), then locked deposits (with early withdrawal penalty).
4. **Approval/Rejection**: A vault admin reviews and approves or rejects the withdrawal request.
5. **Settlement**: On approval, net USDC (after any penalties) is transferred to the user. Penalties go to the fee receiver.

### Key Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| Lock Duration | 180 days | How long deposits are locked |
| Early Withdrawal Fee | 5% (500 bps) | Penalty for withdrawing before lock expiry |
| Minimum Deposit | 10 USDC | Minimum USDC deposit amount |

### Staking Vault Roles

| Role | Description |
|------|-------------|
| `STAKING_VAULT_ADMIN_ROLE` | Manage vault config, approve/reject withdrawals, replenish reserves |
| `STAKING_VAULT_PAUSE_OPERATOR_ROLE` | Pause/unpause the staking vault |

### User View Functions

| Function | Description |
|----------|-------------|
| `getUserDeposits(user)` | Get all deposit IDs for a user |
| `getDeposit(depositId)` | Get a specific deposit record |
| `getTotalDeposited(user)` | Total active USDC across all deposits |
| `getLockedAmount(user)` | USDC still within lock period |
| `getWithdrawableWithoutPenalty(user)` | USDC from expired deposits (penalty-free) |
| `estimateWithdrawal(user, amount)` | Preview net amount and penalty before requesting |
| `getReserveBalance()` | Current USDC reserves available for withdrawals |

---

## Timelock Upgrades

All contract upgrades are gated by an `UpgradeTimelock` (OpenZeppelin `TimelockController`). This introduces a mandatory delay between scheduling and executing an upgrade, giving users time to review changes and exit if they disagree.

### Upgrade Flow

```
Proposer schedules upgrade
        │
        ▼
   ┌──────────┐
   │  Delay   │  (e.g. 24-48 hours)
   └────┬─────┘
        │
        ▼
Executor executes upgrade ──► ProxyAdmin.upgradeAndCall()
```

### Timelock Roles

| Role | Assigned To | Description |
|------|-------------|-------------|
| `PROPOSER_ROLE` | Nav Change Operator | Can schedule upgrade operations |
| `EXECUTOR_ROLE` | Super Admin (multisig) | Can execute operations after delay |
| `CANCELLER_ROLE` | Super Admin (multisig) | Can cancel scheduled operations |
| `TIMELOCK_ADMIN_ROLE` | Super Admin (multisig) | Can grant/revoke roles on timelock |

### Upgrade Scripts

| Script | Description |
|--------|-------------|
| `scripts/upgrade-zopal.ts` | Deploy new zOPAL implementation, generate timelock calldata for multisig |
| `scripts/setup-timelock-multisig.ts` | Deploy UpgradeTimelock with multisig role addresses |
| `scripts/timelock-upgrade-multisig.ts` | Generate schedule/execute calldata for multisig submission |
| `scripts/transfer-proxyadmin.ts` | Transfer ProxyAdmin ownership to the timelock |

### Performing an Upgrade

1. **Deploy new implementation**: `npx hardhat run scripts/upgrade-zopal.ts --network base`
2. **Schedule via multisig**: Submit the generated `schedule` calldata to the timelock through Safe/Gnosis
3. **Wait for delay**: The mandatory timelock delay must pass
4. **Execute via multisig**: Submit the `execute` calldata to finalize the upgrade

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

# RPC URLs
BASE_RPC_URL=https://mainnet.base.org
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org

# API keys for verification
ETHERSCAN_API_KEY=your_etherscan_api_key

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
├── PriceOracle.test.ts            # Price oracle test suite
├── DepositRedemptionFlow.test.ts  # End-to-end deposit and redemption flows
├── VaultOracleIntegration.test.ts # Vault + oracle integration tests
├── Greenlist.test.ts              # Greenlist/whitelist functionality
├── SanctionsAndBlacklist.test.ts  # Sanctions, blacklist, and state transitions
├── EmergencyControls.test.ts      # Pause/unpause and emergency operations
├── ProxyUpgrade.test.ts           # Proxy upgrade pattern tests
├── FiatRedemptionApproval.test.ts # Fiat redemption approval workflow
├── NativeDecimalScaling.test.ts   # Decimal conversion edge cases
├── zOPALStakingVault.test.ts      # Staking vault full test suite
└── TimelockUpgrade.test.ts        # Timelock upgrade flow with role checks
```

### Test Coverage

| Test File | Coverage |
|-----------|----------|
| **PriceOracle** | Deployment, price updates, decimal conversion, tolerance, staleness, edge cases |
| **DepositRedemptionFlow** | Full deposit-to-redemption lifecycle, instant and request flows |
| **VaultOracleIntegration** | Price feed interaction with vault operations |
| **Greenlist** | Add/remove from greenlist, deposit gating |
| **SanctionsAndBlacklist** | Sanctions checks, blacklist enforcement, state transitions (greenlisted → blacklisted) |
| **EmergencyControls** | Pause/unpause per function, emergency withdrawal |
| **ProxyUpgrade** | TransparentUpgradeableProxy upgrade, storage preservation |
| **FiatRedemptionApproval** | Fiat redemption request/approve/reject flow |
| **NativeDecimalScaling** | 6/8/18 decimal conversions, precision edge cases |
| **zOPALStakingVault** | Deposits, lock periods, FIFO withdrawals, early penalties, admin operations, reserve management |
| **TimelockUpgrade** | Role assignments, schedule/delay/execute flow, cancel, initializeV2, state preservation |

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
| 01 | `01-deploy-zopal-token.ts` | `zOPAL` | Deploys zOPAL token |
| 02 | `02-deploy-price-oracle.ts` | `PriceOracle` | Deploys price oracle |
| 03 | `03-deploy-zopal-deposit-vault.ts` | `zOPALDepositVault` | Deploys deposit vault |
| 04 | `04-deploy-zopal-redemption-vault.ts` | `RedemptionVault` | Deploys redemption vault |
| 05 | `05-deploy-all.ts` | `Complete` | Orchestrates full deployment |
| 06 | `06-deploy-timelock.ts` | `UpgradeTimelock` | Deploys UpgradeTimelock with role config |
| 07 | `07-deploy-zopal-staking-vault.ts` | `zOPALStakingVault` | Deploys zOPAL staking vault |

### NPM Scripts

```bash
# Deploy to local hardhat network
pnpm deploy:local

# Deploy to Polygon Amoy testnet
pnpm deploy:amoy

# Deploy to Polygon mainnet
pnpm deploy:mainnet

# Deploy to Base mainnet
pnpm deploy:base

# Deploy to Base Sepolia testnet
pnpm deploy:baseSepolia

# Deploy specific contracts
pnpm deploy:access-control   # Only ZothAccessControl
pnpm deploy:zopal           # Only zOPAL token
pnpm deploy:oracle          # Only PriceOracle
pnpm deploy:deposit-vault   # Only zOPALDepositVault
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
     zOPAL ─────────────────┐
       │                    │
       ▼                    │
  PriceOracle ──────────────┤
       │                    │
       ▼                    ▼
zOPALDepositVault     RedemptionVault
       │
       ▼
UpgradeTimelock
       │
       ▼
zOPALStakingVault
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
    "zOPAL": {
      "name": "zOPAL",
      "symbol": "zOPAL"
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
| `ZOPAL_MINT_OPERATOR_ROLE` | Can mint zOPAL tokens |
| `ZOPAL_BURN_OPERATOR_ROLE` | Can burn zOPAL tokens |
| `ZOPAL_PAUSE_OPERATOR_ROLE` | Can pause/unpause zOPAL token |

### FunctionsAccessControl Roles

| Role | Description |
|------|-------------|
| `ADMIN_ROLE` | General admin role |
| `REQUESTER_ROLE` | Can request Chainlink functions |
| `CONFIG_ROLE` | Can configure oracle parameters |
| `PRICE_ADMIN_ROLE` | Can update prices |

### zOPAL Roles

| Role | Description |
|------|-------------|
| `ZOPAL_MINT_OPERATOR_ROLE` | Can mint zOPAL |
| `ZOPAL_BURN_OPERATOR_ROLE` | Can burn zOPAL |
| `ZOPAL_PAUSE_OPERATOR_ROLE` | Can pause/unpause zOPAL |

### Staking Vault Roles

| Role | Description |
|------|-------------|
| `STAKING_VAULT_ADMIN_ROLE` | Manage staking vault config, approve/reject withdrawals |
| `STAKING_VAULT_PAUSE_OPERATOR_ROLE` | Pause/unpause the staking vault |

### UpgradeTimelock Roles

| Role | Description |
|------|-------------|
| `PROPOSER_ROLE` | Can schedule upgrade operations |
| `EXECUTOR_ROLE` | Can execute operations after delay |
| `CANCELLER_ROLE` | Can cancel scheduled operations |
| `TIMELOCK_ADMIN_ROLE` | Can grant/revoke roles on the timelock |

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
│   ├── utils/             # Utility contracts (proxy, timelock)
│   ├── zOPAL/             # zOPAL token, deposit vault, staking vault
│   ├── DepositVault.sol
│   ├── RedemptionVault.sol
│   └── PriceOracle.sol
├── deploy/                # Deployment scripts (00-07)
├── scripts/               # Operational scripts (upgrades, timelock)
├── test/                  # Test files (11 test suites)
├── exploits/              # Security exploit POCs
├── config/                # Configuration files
│   └── deployed/          # Per-network deployed addresses
├── utils/                 # TypeScript utilities
├── services/              # Service classes
├── deployment-manager/    # Deployment orchestration
├── typechain-types/       # Generated TypeScript types
├── artifacts/             # Compiled contract artifacts
├── hardhat.config.ts      # Hardhat configuration
├── package.json           # Dependencies
└── README.md              # This file
```

---

## Networks

| Network | Chain ID | RPC URL |
|---------|----------|---------|
| Hardhat (local) | 31337 | `http://127.0.0.1:8545` |
| Base Mainnet | 8453 | `https://mainnet.base.org` |
| Base Sepolia | 84532 | `https://sepolia.base.org` |
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

