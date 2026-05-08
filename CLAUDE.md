# CLAUDE.md — Project context for Claude Code reviews

This file is read by the Claude Code GitHub Action before it reviews a PR or
responds to an `@claude` mention. Keep it accurate; it directly shapes review
quality.

## What this repo is

**zVault** is a Solidity / Hardhat protocol that issues the **zOPAL** token via
deposit and redemption vaults, using a Chainlink-style price oracle and
role-based access control. All core contracts are **upgradeable** behind
transparent proxies, with a `ProxyAdmin` owned by an `UpgradeTimelock` whose
proposer is a multisig.

- Solidity: `0.8.9`
- Framework: Hardhat + `hardhat-deploy` + ethers v6
- Package manager: `pnpm@10.6.4`
- Libraries: OpenZeppelin Contracts / Contracts-Upgradeable `4.9`,
  `@chainlink/local`

## Module map

```
contracts/
  DepositVault.sol               core deposit vault (abstract base for zOPAL)
  RedemptionVault.sol            core redemption vault (abstract base for zOPAL)
  PriceOracle.sol                Chainlink-style price feed wrapper
  abstract/
    ManageableVault.sol          shared admin/treasury/oracle/fees logic
    ManageableVaultRedeem.sol    shared redemption logic
    WithSanctionsList.sol        sanctions list gate
    ZothInitializable.sol        initializer plumbing
  access/
    ZothAccessControl.sol        single source of truth for roles
    ZothAccessControlRoles.sol   role identifier constants
    WithZothAccessControl.sol    base mixin
    Pausable.sol                 pause gate
    Greenlistable.sol            greenlist gate
    Blacklistable.sol            blacklist gate
    FunctionsAccessControl.sol   per-function ACL
    WithFunctionsAccessControl.sol
  zOPAL/
    zOPAL.sol                    ERC20 token (mint/burn gated by roles)
    zOPALDepositVault.sol        deposit vault concrete impl
    zOPALStakingVault.sol        staking vault
    zOPALZothAccessControlRoles.sol
    zOPALStakingVaultRoles.sol
  utils/
    UpgradeTimelock.sol          timelock guarding upgrades
    TransparentUpgradeableProxy.sol
    ERC1967Proxy.sol
  libraries/
    DecimalsCorrectionLibrary.sol  decimal normalization (USE THIS, don't reinvent)
  interfaces/                    IDepositVault, IRedemptionVault, IZToken,
                                 IDataFeed, IManageableVault, ISanctionsList...
  mocks/                         test-only mocks (MockDataFeed, MockERC20, ...)

deploy/                          hardhat-deploy ordered scripts
  00-deploy-access-control.ts
  01-deploy-zopal-token.ts
  02-deploy-price-oracle.ts
  03-deploy-zopal-deposit-vault.ts
  04-deploy-zopal-redemption-vault.ts
  05-deploy-all.ts
  06-deploy-timelock.ts
  07-deploy-zopal-staking-vault.ts

scripts/                         ops scripts (timelock, multisig, upgrades)
  setup-timelock-multisig.ts
  deploy-timelock-option-a.ts
  transfer-proxyadmin.ts         hands ProxyAdmin ownership to the timelock
  timelock-upgrade.ts            single-signer timelock upgrade
  timelock-upgrade-multisig.ts   multisig-driven timelock upgrade
  upgrade-zopal.ts
  calc-deposit-params.ts

config/deployed/                 per-network deployed addresses (do not hardcode
                                 these inside contracts)

test/                            Hardhat tests (chai + ethers v6)
audits/                          audit reports
```

## Roles (from `contracts/access/ZothAccessControlRoles.sol`)

| Role | Purpose |
|------|---------|
| `GREENLIST_OPERATOR_ROLE`  | toggles greenlist membership |
| `BLACKLIST_OPERATOR_ROLE`  | toggles blacklist membership |
| `ZOPAL_MINT_OPERATOR_ROLE` | mints zOPAL (vaults hold this) |
| `ZOPAL_BURN_OPERATOR_ROLE` | burns zOPAL (vaults hold this) |
| `ZOPAL_PAUSE_OPERATOR_ROLE`| pauses zOPAL |
| `DEPOSIT_VAULT_ADMIN_ROLE` | admin actions on deposit vault |
| `REDEMPTION_VAULT_ADMIN_ROLE` | admin actions on redemption vault |
| `GREENLISTED_ROLE`         | granted to allowed users (entry gate) |
| `BLACKLISTED_ROLE`         | granted to denied users (exit gate) |

Every external/public state-changing function MUST be gated by one of these
roles (or by an explicit pause/sanctions/blacklist/greenlist check).

## Upgrade flow (do not bypass)

1. Deploy new implementation contract.
2. Multisig proposes the upgrade through `UpgradeTimelock`
   (`scripts/timelock-upgrade-multisig.ts`).
3. Wait for the timelock delay.
4. Multisig executes the upgrade; `ProxyAdmin` (owned by the timelock) calls
   `upgradeAndCall` on the proxy.
5. `scripts/transfer-proxyadmin.ts` is what originally moves `ProxyAdmin`
   ownership to the timelock — it should not be undone.

Any PR that adds a direct `upgradeTo`, transfers `ProxyAdmin` ownership away
from the timelock, or shortens the delay without justification is a blocker.

## Build / test commands

```
pnpm install
pnpm compile       # hardhat compile
pnpm test          # hardhat test
pnpm deploy:hardhat
pnpm deploy:polygon
pnpm deploy:base
```

## Always flag in review

- Hardcoded chain addresses inside `contracts/**/*.sol` (must come from
  initializer args or `ZothAccessControl`).
- Missing role gate on a state-changing external/public function.
- ERC20 transfers without `SafeERC20` or without checking the return value.
- Reentrancy: external call followed by state mutation, or missing
  `nonReentrant`.
- Oracle reads without staleness / `answeredInRound` / negative price guards.
- Decimal math that bypasses `DecimalsCorrectionLibrary`.
- Rounding direction that favors the user over the protocol on
  deposit/redeem accounting.
- Storage layout drift in upgradeable contracts (inserted, reordered, or
  retyped state vars; missing `__gap`).
- Constructor logic in upgradeable contracts (must use initializers, and
  the constructor should call `_disableInitializers()`).
- Missing events on state changes.
- Pause / sanctions / blacklist gates skipped on a user-facing entry point.
- Upgrade path bypassed (direct `upgradeTo`, `ProxyAdmin` ownership move,
  shortened timelock delay).
- TS/deploy: missing env-var guards, wrong deploy ordering, accidental
  mainnet network names.

## Style

- Solidity: explicit visibility, NatSpec on externals, custom errors
  preferred over revert strings in new code.
- TypeScript: strict types, no `any`, prefer `ethers` v6 idioms.
- Tests live in `test/` and use chai matchers from
  `@nomicfoundation/hardhat-chai-matchers`.
