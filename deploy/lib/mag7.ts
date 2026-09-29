import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeploymentManager } from '../../deployment-manager/DeploymentManager'
import { ConfigService } from '../../services/ConfigService'
import { Logger } from '../../utils/logger'

/** Shared helpers used by MAG7 deploy scripts. */

export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

/**
 * Values MAG7 deploy scripts actually write. Vault fees use 100 = 1% (10000 = 100%),
 * so a fee of 10 is 10 bps. PriceOracle tolerance uses 10000 = 100%, so 5 is 5 bps.
 */
export const MAG7_LAUNCH = {
    oraclePriceDecimals: 4,
    oracleToleranceBps: 5,
    oracleMaxStalenessSec: 108000,
    oracleInitialPriceRaw: 10000,
    variationTolerance: 1,
    depositInstantFee: 0,
    depositInstantDailyLimit: ethers.parseEther('10000000'),
    depositTokenFee: 0,
    depositTokenAllowance: ethers.MaxUint256,
    minAmount: ethers.parseEther('0.0001'),
    minFirstDeposit: ethers.parseEther('0.001'),
    maxSupplyCap: ethers.parseEther('1000000000'),
    redemptionInstantFee: 1000,
    redemptionInstantDailyLimit: 1n,
    redemptionTokenFee: 10,
    pauseDepositInstant: true,
    pauseRedeemInstant: true,
} as const

export const MAG7_ROLES = {
    DEPOSIT_VAULT_ADMIN: ethers.keccak256(ethers.toUtf8Bytes('MAG7_DEPOSIT_VAULT_ADMIN_ROLE')),
    REDEMPTION_VAULT_ADMIN: ethers.keccak256(ethers.toUtf8Bytes('MAG7_REDEMPTION_VAULT_ADMIN_ROLE')),
    MINT_OPERATOR: ethers.keccak256(ethers.toUtf8Bytes('MAG7_MINT_OPERATOR_ROLE')),
    BURN_OPERATOR: ethers.keccak256(ethers.toUtf8Bytes('MAG7_BURN_OPERATOR_ROLE')),
    PAUSE_OPERATOR: ethers.keccak256(ethers.toUtf8Bytes('MAG7_PAUSE_OPERATOR_ROLE')),
}

/** Both depositInstant overloads. MAG7 users use depositRequest instead. */
export const MAG7_DEPOSIT_INSTANT_SIGNATURES = [
    'depositInstant(address,uint256,uint256,bytes32)',
    'depositInstant(address,uint256,uint256,bytes32,address)',
] as const

export function getMag7VaultReceivers(
    config: {
        mag7Roles?: {
            tokensReceiver?: string
            feeReceiver?: string
            requestRedeemer?: string
        }
    },
    deployer: string,
    networkName: string
): { tokensReceiver: string; feeReceiver: string; requestRedeemer: string } {
    const mag7 = config.mag7Roles || {}
    const tokensReceiver = mag7.tokensReceiver
    const feeReceiver = mag7.feeReceiver
    const requestRedeemer = mag7.requestRedeemer

    if (tokensReceiver && feeReceiver && requestRedeemer) {
        return { tokensReceiver, feeReceiver, requestRedeemer }
    }

    if (isLocalNetwork(networkName)) {
        return {
            tokensReceiver: tokensReceiver || deployer,
            feeReceiver: feeReceiver || deployer,
            requestRedeemer: requestRedeemer || deployer,
        }
    }

    throw new Error(
        'mag7Roles.tokensReceiver, mag7Roles.feeReceiver, and mag7Roles.requestRedeemer ' +
            'must be set in config/deployment.json. MAG7 must not reuse zOPAL receivers.'
    )
}

export function requireAccessControl(config: { contractAddresses: Record<string, string> }): string {
    const accessControlAddress = config.contractAddresses['ZothAccessControl']
    if (!accessControlAddress) {
        throw new Error(
            'ZothAccessControl not found in config/deployed/<network>.json. ' +
            'MAG7 attaches to the existing protocol access-control contract.'
        )
    }
    return accessControlAddress
}

export function isLocalNetwork(networkName: string): boolean {
    return networkName === 'hardhat' || networkName === 'localhost'
}

export async function confirmMag7Launch(
    hre: HardhatRuntimeEnvironment,
    networkName: string
): Promise<void> {
    const deploymentManager = new DeploymentManager(networkName, hre)
    await deploymentManager.initialize()
    const config = await deploymentManager.getConfig()
    const [deployer] = await hre.ethers.getSigners()
    const mag7 = config.mag7Roles || {}
    const receivers = getMag7VaultReceivers(config, deployer.address, networkName)
    const usdc = networkName === 'base' ? BASE_USDC : 'MAG7MockUSDC (deployed locally)'
    const L = MAG7_LAUNCH

    const pad = (label: string, value: string) => `  ${label.padEnd(36)} ${value}`
    const lines = [
        '',
        '==================== MAG7 LAUNCH REVIEW ====================',
        `Network                         ${networkName}`,
        `Deployer                        ${deployer.address}`,
        '',
        '--- Shared (existing, not redeployed) ---',
        pad('ZothAccessControl', config.contractAddresses['ZothAccessControl'] || '(missing)'),
        pad('ProxyAdmin', config.contractAddresses['ProxyAdmin'] || '(missing)'),
        pad('UpgradeTimelock', config.contractAddresses['UpgradeTimelock'] || '(missing)'),
        pad('ZothAccessControl DEFAULT_ADMIN', config.roles?.defaultAdmin || '(unknown)'),
        pad('Sanctions list', config.sanctionsList || ethers.ZeroAddress),
        pad('USDC', usdc),
        '',
        '--- MAG7 wallets ---',
        pad('tokensReceiver', receivers.tokensReceiver),
        pad('feeReceiver', receivers.feeReceiver),
        pad('requestRedeemer', receivers.requestRedeemer),
        pad('deposit vault admin', mag7.depositVaultAdmin || ''),
        pad('redemption vault admin', mag7.redemptionVaultAdmin || ''),
        pad('pause operator', mag7.pauseOperator || ''),
        pad('greenlist / blacklist operator', mag7.greenlistOperator || ''),
        pad('MAG7 FAC admin (oracle ACL)', mag7.defaultAdmin || ''),
        pad('MAG7 PRICE_ADMIN', mag7.priceAdmin || ''),
        pad('MAG7 CONFIG', mag7.configRole || ''),
        '',
        '--- Oracle (MAG7 PriceOracle) ---',
        pad('Price decimals', String(L.oraclePriceDecimals)),
        pad('Oracle tolerance', `${L.oracleToleranceBps} bps`),
        pad('Oracle max staleness', `${L.oracleMaxStalenessSec} sec (${L.oracleMaxStalenessSec / 3600}h)`),
        pad('Initial NAV', `$${(L.oracleInitialPriceRaw / 10 ** L.oraclePriceDecimals).toFixed(4)} (raw ${L.oracleInitialPriceRaw})`),
        '',
        '--- Vault params MAG7 will set ---',
        pad('Safe approval variation', `${L.variationTolerance} bps`),
        pad('Deposit USDC fee / instant fee', `${L.depositTokenFee} bps / ${L.depositInstantFee} bps`),
        pad('Redemption USDC fee / instant fee', `${L.redemptionTokenFee} bps / ${L.redemptionInstantFee} (${(L.redemptionInstantFee / 100).toFixed(2)}%)`),
        pad('Deposit instant daily cap', `${ethers.formatEther(L.depositInstantDailyLimit)} (18dp USD)`),
        pad('Redemption instant daily cap', L.redemptionInstantDailyLimit.toString()),
        pad('Deposit token allowance', L.depositTokenAllowance === ethers.MaxUint256 ? 'unlimited' : L.depositTokenAllowance.toString()),
        pad('Deposit/redemption min', `${ethers.formatEther(L.minAmount)} zMAG7`),
        pad('First-deposit min', `${ethers.formatEther(L.minFirstDeposit)} zMAG7`),
        pad('Supply cap', `${ethers.formatEther(L.maxSupplyCap)} zMAG7`),
        pad('depositInstant', L.pauseDepositInstant ? 'PAUSED (users use depositRequest)' : 'enabled'),
        pad('redeemInstant', L.pauseRedeemInstant ? 'PAUSED (users use redeemRequest)' : 'enabled'),
        '',
        'After MAG7Complete: out/mag7-role-grants-<network>.json lists leftover grants.',
        'Old deployer cannot grant ZothAccessControl roles; 0x973B… must submit those.',
        '============================================================',
        '',
    ]

    for (const line of lines) {
        console.log(line)
    }

    const fs = await import('fs/promises')
    const path = await import('path')
    const outDir = path.resolve(process.cwd(), 'out')
    await fs.mkdir(outDir, { recursive: true })
    const reviewPath = path.join(outDir, `mag7-launch-review-${networkName}.md`)
    await fs.writeFile(reviewPath, `# MAG7 launch review (${networkName})\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`)
    Logger.info('Wrote MAG7 launch review', reviewPath)

    if (isLocalNetwork(networkName)) {
        Logger.info('Local network — skipping interactive confirm')
        return
    }

    if (process.env.MAG7_SKIP_CONFIRM === 'true' || process.env.MAG7_CONFIRM === 'yes') {
        Logger.warning('Skipping interactive confirm because MAG7_SKIP_CONFIRM or MAG7_CONFIRM=yes is set')
        return
    }

    if (!process.stdin.isTTY) {
        throw new Error(
            'MAG7 Base deploy needs a TTY to confirm launch values. Re-run in a terminal and type yes, ' +
                'or set MAG7_CONFIRM=yes after reviewing out/mag7-launch-review-<network>.md'
        )
    }

    const readline = await import('readline')
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer = await new Promise<string>((resolve) => {
        rl.question('Type yes to proceed with MAG7 deployment: ', (value) => {
            rl.close()
            resolve(value.trim().toLowerCase())
        })
    })

    if (answer !== 'yes') {
        throw new Error(`MAG7 deploy aborted (got "${answer || '(empty)'}", expected yes)`)
    }

    Logger.success('MAG7 launch values confirmed', undefined, 1)
}

/**
 * Attach MAG7 proxies to the protocol ProxyAdmin.
 * On live networks the address must already exist in deployed config.
 */
export async function ensureSharedProxyAdmin(
    deploymentManager: DeploymentManager,
    config: { contractAddresses: Record<string, string> },
    networkName: string
): Promise<string> {
    const existing = config.contractAddresses['ProxyAdmin']

    if (!isLocalNetwork(networkName)) {
        if (!existing) {
            throw new Error(
                'ProxyAdmin not found in config/deployed/<network>.json. ' +
                'MAG7 proxies must use the existing protocol ProxyAdmin.'
            )
        }
        return deploymentManager.useExistingProxyAdmin(existing)
    }

    return deploymentManager.deployProxyAdmin()
}

export async function requireUpgradeTimelock(
    config: { contractAddresses: Record<string, string> }
): Promise<string> {
    const timelockAddress = config.contractAddresses['UpgradeTimelock']
    if (!timelockAddress) {
        throw new Error(
            'UpgradeTimelock not found in config/deployed/<network>.json. ' +
            'MAG7 upgrades use the existing protocol timelock.'
        )
    }
    return timelockAddress
}

/**
 * Confirm ProxyAdmin is owned by UpgradeTimelock.
 * On hardhat/localhost, deploys a timelock if one is missing so the same
 * ownership model can be tested without a prior zOPAL deploy.
 */
export async function ensureSharedTimelockGovernance(
    hre: HardhatRuntimeEnvironment,
    networkName: string,
    config: { contractAddresses: Record<string, string>; timelock?: { minDelay?: number } },
    proxyAdminAddress: string
): Promise<string> {
    const proxyAdmin = await hre.ethers.getContractAt('ProxyAdmin', proxyAdminAddress)
    const currentOwner = await proxyAdmin.owner()

    if (!isLocalNetwork(networkName)) {
        const timelockAddress = await requireUpgradeTimelock(config)
        if (currentOwner.toLowerCase() !== timelockAddress.toLowerCase()) {
            throw new Error(
                `ProxyAdmin ${proxyAdminAddress} is owned by ${currentOwner}, not UpgradeTimelock ${timelockAddress}. ` +
                'MAG7 does not transfer ProxyAdmin ownership. Run scripts/transfer-proxyadmin.ts first.'
            )
        }
        Logger.success('Shared ProxyAdmin is owned by UpgradeTimelock', timelockAddress, 1)
        return timelockAddress
    }

    const existingTimelock = config.contractAddresses['UpgradeTimelock']
    if (existingTimelock) {
        const code = await hre.ethers.provider.getCode(existingTimelock)
        if (code && code !== '0x') {
            if (currentOwner.toLowerCase() !== existingTimelock.toLowerCase()) {
                const [deployer] = await hre.ethers.getSigners()
                if (currentOwner.toLowerCase() === deployer.address.toLowerCase()) {
                    Logger.log('Transferring local ProxyAdmin to existing UpgradeTimelock', existingTimelock, 1)
                    const tx = await proxyAdmin.transferOwnership(existingTimelock)
                    await tx.wait()
                } else {
                    throw new Error(
                        `Local ProxyAdmin owner ${currentOwner} is neither deployer nor UpgradeTimelock ${existingTimelock}`
                    )
                }
            }
            Logger.success('Local ProxyAdmin is owned by UpgradeTimelock', existingTimelock, 1)
            return existingTimelock
        }
    }

    const [deployer] = await hre.ethers.getSigners()
    const minDelay = config.timelock?.minDelay ?? 1
    Logger.section('Deploying UpgradeTimelock')
    Logger.log('Min delay', `${minDelay} seconds`, 1)

    const UpgradeTimelock = await hre.ethers.getContractFactory('UpgradeTimelock')
    const timelock = await UpgradeTimelock.deploy(
        minDelay,
        [deployer.address],
        [deployer.address],
        deployer.address
    )
    await timelock.waitForDeployment()
    const timelockAddress = await timelock.getAddress()

    await hre.deployments.save('UpgradeTimelock', {
        abi: JSON.parse(UpgradeTimelock.interface.formatJson()),
        address: timelockAddress,
        args: [minDelay, [deployer.address], [deployer.address], deployer.address],
    })

    const configService = ConfigService.getInstance()
    await configService.updateAddress(networkName, 'UpgradeTimelock', timelockAddress)
    Logger.success('UpgradeTimelock deployed', timelockAddress, 1)

    if (currentOwner.toLowerCase() === deployer.address.toLowerCase()) {
        const tx = await proxyAdmin.transferOwnership(timelockAddress)
        await tx.wait()
        Logger.success('ProxyAdmin ownership transferred to UpgradeTimelock', timelockAddress, 1)
    } else if (currentOwner.toLowerCase() !== timelockAddress.toLowerCase()) {
        throw new Error(`Cannot transfer local ProxyAdmin; owner is ${currentOwner}`)
    }

    return timelockAddress
}

export async function assertProxyUsesSharedAdmin(
    hre: HardhatRuntimeEnvironment,
    proxyAdminAddress: string,
    proxyAddress: string,
    label: string
): Promise<void> {
    const proxyAdmin = await hre.ethers.getContractAt('ProxyAdmin', proxyAdminAddress)
    const admin = await proxyAdmin.getProxyAdmin(proxyAddress)
    if (admin.toLowerCase() !== proxyAdminAddress.toLowerCase()) {
        throw new Error(
            `${label} proxy ${proxyAddress} is administered by ${admin}, expected shared ProxyAdmin ${proxyAdminAddress}`
        )
    }
    Logger.success(`${label} uses shared ProxyAdmin`, proxyAddress, 1)
}

/**
 * Native USDC on Base. Mock USDC (6 decimals) on local networks.
 */
export async function getOrDeployPaymentToken(
    hre: HardhatRuntimeEnvironment,
    networkName: string
): Promise<string> {
    if (networkName === 'base') {
        return BASE_USDC
    }

    const existing = await hre.deployments.getOrNull('MAG7MockUSDC')
    if (existing) {
        Logger.info('Using existing MAG7MockUSDC', existing.address)
        return existing.address
    }

    Logger.log('Deploying MAG7MockUSDC (6 decimals)', undefined, 1)
    const MockERC20 = await hre.ethers.getContractFactory('MockERC20')
    const token = await MockERC20.deploy('USD Coin', 'USDC', 6)
    await token.waitForDeployment()
    const address = await token.getAddress()

    await hre.deployments.save('MAG7MockUSDC', {
        abi: JSON.parse(MockERC20.interface.formatJson()),
        address,
        args: ['USD Coin', 'USDC', 6],
    })

    const configService = ConfigService.getInstance()
    await configService.updateAddress(networkName, 'MAG7MockUSDC', address)
    Logger.success('MAG7MockUSDC deployed', address, 1)
    return address
}

export async function grantRoleIfNeeded(
    contract: { hasRole: (role: string, account: string) => Promise<boolean>; grantRole: (role: string, account: string) => Promise<{ wait: () => Promise<unknown> }> },
    role: string,
    account: string,
    roleName: string
): Promise<void> {
    const alreadyHas = await contract.hasRole(role, account)
    if (alreadyHas) {
        Logger.info(`${roleName} already assigned to ${account}`)
        return
    }
    const tx = await contract.grantRole(role, account)
    await tx.wait()
    Logger.success(`${roleName} granted to ${account}`, undefined, 1)
}

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash

export const SHARED_AC_ROLES = {
    GREENLIST_OPERATOR: ethers.keccak256(ethers.toUtf8Bytes('GREENLIST_OPERATOR_ROLE')),
    BLACKLIST_OPERATOR: ethers.keccak256(ethers.toUtf8Bytes('BLACKLIST_OPERATOR_ROLE')),
}

export type RoleManager = {
    hasRole: (role: string, account: string) => Promise<boolean>
    grantRole: (role: string, account: string) => Promise<{ wait: () => Promise<unknown> }>
}

export async function deployerCanGrantAccessControlRoles(
    accessControl: RoleManager,
    deployer: string
): Promise<boolean> {
    return accessControl.hasRole(DEFAULT_ADMIN_ROLE, deployer)
}

/**
 * Grant a ZothAccessControl role when the deployer is DEFAULT_ADMIN.
 * Otherwise skip so MAG7Complete can finish and write the grant file.
 */
export async function grantAccessControlRoleIfAuthorized(
    accessControl: RoleManager,
    deployer: string,
    role: string,
    account: string,
    roleName: string
): Promise<'granted' | 'already' | 'skipped'> {
    const alreadyHas = await accessControl.hasRole(role, account)
    if (alreadyHas) {
        Logger.info(`${roleName} already assigned to ${account}`)
        return 'already'
    }

    if (!(await deployerCanGrantAccessControlRoles(accessControl, deployer))) {
        Logger.warning(
            `${roleName} not granted — deployer is not ZothAccessControl DEFAULT_ADMIN`,
            account,
            1
        )
        return 'skipped'
    }

    const tx = await accessControl.grantRole(role, account)
    await tx.wait()
    Logger.success(`${roleName} granted to ${account}`, undefined, 1)
    return 'granted'
}

export interface Mag7PostDeployAddresses {
    zMAG7: string
    MAG7PriceOracle: string
    MAG7FunctionsAccessControl?: string
    zMAG7DepositVault: string
    zMAG7RedemptionVault: string
    ProxyAdmin: string
    UpgradeTimelock: string
}

interface PendingTx {
    step: number
    signer: string
    to: string
    method: string
    role?: string
    roleHash?: string
    account?: string
    description: string
    data: string
}

export async function writeMag7PostDeployPlan(
    hre: HardhatRuntimeEnvironment,
    networkName: string,
    deployer: string,
    accessControlAddress: string,
    mag7Roles: {
        defaultAdmin?: string
        depositVaultAdmin?: string
        redemptionVaultAdmin?: string
        pauseOperator?: string
        greenlistOperator?: string
        blacklistOperator?: string
        priceAdmin?: string
        configRole?: string
        tokensReceiver?: string
        feeReceiver?: string
        requestRedeemer?: string
    },
    addresses: Mag7PostDeployAddresses,
    accessControlAdminHint: string
): Promise<string> {
    const fs = await import('fs/promises')
    const path = await import('path')

    const accessControl = await hre.ethers.getContractAt('ZothAccessControl', accessControlAddress)
    const depositVault = await hre.ethers.getContractAt('zMAG7DepositVault', addresses.zMAG7DepositVault)
    const redemptionVault = await hre.ethers.getContractAt('zMAG7RedemptionVault', addresses.zMAG7RedemptionVault)

    const usdcAddress = await getOrDeployPaymentToken(hre, networkName)
    const dataFeedAddress = addresses.MAG7PriceOracle
    const canGrant = await deployerCanGrantAccessControlRoles(accessControl, deployer)

    const grantRoleIface = accessControl.interface
    const pending: PendingTx[] = []
    const completed: string[] = []
    let step = 1

    const queueGrant = async (
        roleName: string,
        roleHash: string,
        account: string | undefined,
        description: string
    ) => {
        if (!account) {
            return
        }
        if (await accessControl.hasRole(roleHash, account)) {
            completed.push(`${roleName} already granted to ${account}`)
            return
        }
        pending.push({
            step: step++,
            signer: accessControlAdminHint,
            to: accessControlAddress,
            method: 'grantRole(bytes32,address)',
            role: roleName,
            roleHash,
            account,
            description,
            data: grantRoleIface.encodeFunctionData('grantRole', [roleHash, account]),
        })
    }

    await queueGrant(
        'MAG7_MINT_OPERATOR_ROLE',
        MAG7_ROLES.MINT_OPERATOR,
        addresses.zMAG7DepositVault,
        'Deposit vault must mint zMAG7'
    )
    await queueGrant(
        'MAG7_BURN_OPERATOR_ROLE',
        MAG7_ROLES.BURN_OPERATOR,
        addresses.zMAG7RedemptionVault,
        'Redemption vault must burn zMAG7'
    )
    await queueGrant(
        'MAG7_DEPOSIT_VAULT_ADMIN_ROLE',
        MAG7_ROLES.DEPOSIT_VAULT_ADMIN,
        mag7Roles.depositVaultAdmin,
        'MAG7 deposit vault admin (add USDC, vault config)'
    )
    await queueGrant(
        'MAG7_REDEMPTION_VAULT_ADMIN_ROLE',
        MAG7_ROLES.REDEMPTION_VAULT_ADMIN,
        mag7Roles.redemptionVaultAdmin,
        'MAG7 redemption vault admin (add USDC, pause instant redeem)'
    )
    await queueGrant(
        'MAG7_PAUSE_OPERATOR_ROLE',
        MAG7_ROLES.PAUSE_OPERATOR,
        mag7Roles.pauseOperator,
        'Pause/unpause the zMAG7 token'
    )
    await queueGrant(
        'GREENLIST_OPERATOR_ROLE',
        SHARED_AC_ROLES.GREENLIST_OPERATOR,
        mag7Roles.greenlistOperator,
        'Shared greenlist operator (no-op if already granted for zOPAL)'
    )
    await queueGrant(
        'BLACKLIST_OPERATOR_ROLE',
        SHARED_AC_ROLES.BLACKLIST_OPERATOR,
        mag7Roles.blacklistOperator,
        'Shared blacklist operator (no-op if already granted for zOPAL)'
    )

    if (addresses.MAG7FunctionsAccessControl) {
        const fac = await hre.ethers.getContractAt(
            'FunctionsAccessControl',
            addresses.MAG7FunctionsAccessControl
        )
        const PRICE_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes('PRICE_ADMIN_ROLE'))
        const CONFIG_ROLE = ethers.keccak256(ethers.toUtf8Bytes('CONFIG_ROLE'))
        const FAC_DEFAULT_ADMIN = ethers.ZeroHash
        const deployerIsFacAdmin = await fac.hasRole(FAC_DEFAULT_ADMIN, deployer)
        const facAdminSigner = deployerIsFacAdmin
            ? deployer
            : mag7Roles.defaultAdmin || '(MAG7 FunctionsAccessControl DEFAULT_ADMIN)'
        const facIface = fac.interface

        const queueFacGrant = async (
            roleName: string,
            roleHash: string,
            account: string | undefined,
            description: string
        ) => {
            if (!account) {
                return
            }
            if (await fac.hasRole(roleHash, account)) {
                completed.push(`${roleName} already granted on MAG7FunctionsAccessControl to ${account}`)
                return
            }
            pending.push({
                step: step++,
                signer: facAdminSigner,
                to: addresses.MAG7FunctionsAccessControl as string,
                method: 'grantRole(bytes32,address)',
                role: roleName,
                roleHash,
                account,
                description,
                data: facIface.encodeFunctionData('grantRole', [roleHash, account]),
            })
        }

        await queueFacGrant(
            'PRICE_ADMIN_ROLE',
            PRICE_ADMIN_ROLE,
            mag7Roles.priceAdmin,
            'MAG7 oracle PRICE_ADMIN (setPrice)'
        )
        await queueFacGrant(
            'CONFIG_ROLE',
            CONFIG_ROLE,
            mag7Roles.configRole,
            'MAG7 oracle CONFIG_ROLE'
        )
        if (isLocalNetwork(networkName)) {
            completed.push('Local: deployer retains MAG7 FunctionsAccessControl DEFAULT_ADMIN')
        } else {
            await queueFacGrant(
                'DEFAULT_ADMIN_ROLE',
                FAC_DEFAULT_ADMIN,
                mag7Roles.defaultAdmin,
                'MAG7 FunctionsAccessControl DEFAULT_ADMIN'
            )
        }
    }

    const depositTokens = (await depositVault.getPaymentTokens()).map((t: string) => t.toLowerCase())
    if (!depositTokens.includes(usdcAddress.toLowerCase())) {
        pending.push({
            step: step++,
            signer: mag7Roles.depositVaultAdmin || '(MAG7_DEPOSIT_VAULT_ADMIN_ROLE holder)',
            to: addresses.zMAG7DepositVault,
            method: 'addPaymentToken(address,address,uint256,uint256,bool)',
            description: `Add USDC ${usdcAddress} as deposit payment token (${MAG7_LAUNCH.depositTokenFee} bps fee, stable)`,
            data: depositVault.interface.encodeFunctionData('addPaymentToken', [
                usdcAddress,
                dataFeedAddress,
                MAG7_LAUNCH.depositTokenFee,
                MAG7_LAUNCH.depositTokenAllowance,
                true,
            ]),
        })
    } else {
        completed.push(`USDC already added on zMAG7DepositVault`)
    }

    for (const signature of MAG7_DEPOSIT_INSTANT_SIGNATURES) {
        const selector = depositVault.interface.getFunction(signature).selector
        if (!(await depositVault.fnPaused(selector))) {
            pending.push({
                step: step++,
                signer: mag7Roles.depositVaultAdmin || '(MAG7_DEPOSIT_VAULT_ADMIN_ROLE holder)',
                to: addresses.zMAG7DepositVault,
                method: 'pauseFn(bytes4)',
                description: `Pause ${signature} so MAG7 users deposit via depositRequest`,
                data: depositVault.interface.encodeFunctionData('pauseFn', [selector]),
            })
        } else {
            completed.push(`${signature} already paused on zMAG7DepositVault`)
        }
    }

    const redemptionTokens = (await redemptionVault.getPaymentTokens()).map((t: string) => t.toLowerCase())
    if (!redemptionTokens.includes(usdcAddress.toLowerCase())) {
        pending.push({
            step: step++,
            signer: mag7Roles.redemptionVaultAdmin || '(MAG7_REDEMPTION_VAULT_ADMIN_ROLE holder)',
            to: addresses.zMAG7RedemptionVault,
            method: 'addPaymentToken(address,address,uint256,bool)',
            description: `Add USDC ${usdcAddress} as redemption payment token (${MAG7_LAUNCH.redemptionTokenFee} bps fee, stable)`,
            data: redemptionVault.interface.encodeFunctionData('addPaymentToken', [
                usdcAddress,
                dataFeedAddress,
                MAG7_LAUNCH.redemptionTokenFee,
                true,
            ]),
        })
    } else {
        completed.push(`USDC already added on zMAG7RedemptionVault`)
    }

    const redeemInstantSelector = redemptionVault.interface.getFunction('redeemInstant').selector
    if (!(await redemptionVault.fnPaused(redeemInstantSelector))) {
        pending.push({
            step: step++,
            signer: mag7Roles.redemptionVaultAdmin || '(MAG7_REDEMPTION_VAULT_ADMIN_ROLE holder)',
            to: addresses.zMAG7RedemptionVault,
            method: 'pauseFn(bytes4)',
            description: 'Pause redeemInstant (same as zOPAL)',
            data: redemptionVault.interface.encodeFunctionData('pauseFn', [redeemInstantSelector]),
        })
    } else {
        completed.push('redeemInstant already paused on zMAG7RedemptionVault')
    }

    const plan = {
        network: networkName,
        timestamp: new Date().toISOString(),
        deployer,
        deployerCanGrantZothAccessControlRoles: canGrant,
        submitAccessControlGrantsAs: accessControlAdminHint,
        contracts: {
            ZothAccessControl: accessControlAddress,
            ...addresses,
            USDC: usdcAddress,
        },
        mag7Roles,
        pending,
        completed,
        safeTransactions: pending.map((tx) => ({
            to: tx.to,
            value: '0',
            data: tx.data,
            operation: 0,
            description: `${tx.step}. ${tx.description} (signer: ${tx.signer})`,
        })),
    }

    const outDir = path.resolve(process.cwd(), 'out')
    await fs.mkdir(outDir, { recursive: true })
    const jsonPath = path.join(outDir, `mag7-role-grants-${networkName}.json`)
    const mdPath = path.join(outDir, `mag7-role-grants-${networkName}.md`)
    await fs.writeFile(jsonPath, JSON.stringify(plan, null, 2))
    await fs.writeFile(mdPath, renderMag7PostDeployMarkdown(plan))

    Logger.success('Wrote MAG7 post-deploy grant file', jsonPath, 1)
    Logger.log('Markdown', mdPath, 1)
    return jsonPath
}

function renderMag7PostDeployMarkdown(plan: {
    network: string
    timestamp: string
    deployer: string
    deployerCanGrantZothAccessControlRoles: boolean
    submitAccessControlGrantsAs: string
    contracts: Record<string, string | undefined>
    mag7Roles: Record<string, string | undefined>
    pending: PendingTx[]
    completed: string[]
}): string {
    const pendingRows = plan.pending
        .map(
            (tx) =>
                `| ${tx.step} | \`${tx.signer}\` | \`${tx.to}\` | \`${tx.method}\` | ${tx.role ?? '—'} | \`${tx.account ?? '—'}\` | ${tx.description} |`
        )
        .join('\n')

    const completedList = plan.completed.length
        ? plan.completed.map((line) => `- ${line}`).join('\n')
        : '- None'

    const calldataBlocks = plan.pending
        .map(
            (tx) => `### ${tx.step}. ${tx.description}

- Signer: \`${tx.signer}\`
- To: \`${tx.to}\`
- Data: \`${tx.data}\`
`
        )
        .join('\n')

    return `# MAG7 post-deploy grants (${plan.network})

Generated: ${plan.timestamp}

Deployer: \`${plan.deployer}\`

Deployer can grant ZothAccessControl roles: **${plan.deployerCanGrantZothAccessControlRoles}**

Submit ZothAccessControl \`grantRole\` transactions from \`DEFAULT_ADMIN_ROLE\`: \`${plan.submitAccessControlGrantsAs}\`

${plan.deployerCanGrantZothAccessControlRoles
    ? 'This deployer was able to grant ZothAccessControl roles during MAG7Complete.'
    : 'This deployer is **not** ZothAccessControl `DEFAULT_ADMIN` (typical for the old zOPAL deployer). MAG7Complete skipped those grants so the deploy can finish. Submit the pending AccessControl rows below from the address above.'}

MAG7 FunctionsAccessControl is a **new** contract. The deployer can grant MAG7 oracle roles (\`PRICE_ADMIN\`, \`CONFIG\`, MAG7 FAC \`DEFAULT_ADMIN\`) during MAG7Complete. Those are **not** \`MAG7_DEPOSIT_VAULT_ADMIN_ROLE\` / \`MAG7_REDEMPTION_VAULT_ADMIN_ROLE\`. Vault-admin roles live on the shared ZothAccessControl and must be granted by \`0x973B…\`.

Do MAG7 vault \`addPaymentToken\` / \`pauseFn\` **after** the matching vault-admin role is granted on ZothAccessControl.

## After MAG7Complete (manual)

1. Submit pending **ZothAccessControl** \`grantRole\` txs from \`${plan.submitAccessControlGrantsAs}\` (old deployer cannot). This includes MAG7 vault-admin, mint, burn, and pause roles.
2. MAG7 deposit vault admin: add USDC, pause both \`depositInstant\` overloads. Leave \`depositRequest\` unpaused.
3. MAG7 redemption vault admin: add USDC, pause \`redeemInstant\`.
4. Users deposit with \`depositRequest\`; MAG7 deposit vault admin later \`approveRequest\`.
5. Do **not** transfer shared ZothAccessControl \`DEFAULT_ADMIN_ROLE\` or ProxyAdmin ownership. MAG7 FunctionsAccessControl admin is already handled in MAG7Complete.

## Contracts

| Name | Address |
|------|---------|
${Object.entries(plan.contracts)
    .filter(([, address]) => Boolean(address))
    .map(([name, address]) => `| ${name} | \`${address}\` |`)
    .join('\n')}

## MAG7 role recipients

| Role | Address |
|------|---------|
| MAG7 FunctionsAccessControl admin | \`${plan.mag7Roles.defaultAdmin ?? ''}\` |
| MAG7 deposit vault admin | \`${plan.mag7Roles.depositVaultAdmin ?? ''}\` |
| MAG7 redemption vault admin | \`${plan.mag7Roles.redemptionVaultAdmin ?? ''}\` |
| MAG7 pause operator | \`${plan.mag7Roles.pauseOperator ?? ''}\` |
| Greenlist operator | \`${plan.mag7Roles.greenlistOperator ?? ''}\` |
| Blacklist operator | \`${plan.mag7Roles.blacklistOperator ?? ''}\` |
| MAG7 price admin (FunctionsAccessControl) | \`${plan.mag7Roles.priceAdmin ?? ''}\` |
| MAG7 config role (FunctionsAccessControl) | \`${plan.mag7Roles.configRole ?? ''}\` |
| MAG7 tokensReceiver | \`${plan.mag7Roles.tokensReceiver ?? ''}\` |
| MAG7 feeReceiver | \`${plan.mag7Roles.feeReceiver ?? ''}\` |
| MAG7 requestRedeemer | \`${plan.mag7Roles.requestRedeemer ?? ''}\` |

## Already applied

${completedList}

## Pending

| Step | Signer | Contract | Method | Role | Recipient | Why |
|------|--------|----------|--------|------|-----------|-----|
${pendingRows || '| — | — | — | — | — | — | Nothing pending |'}

## Calldata

${calldataBlocks || 'Nothing pending.'}
`
}
