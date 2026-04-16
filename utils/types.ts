export interface BaseConfig {
    network: string
    chainId: number
}

export interface ContractAddresses {
    [key: string]: string
}

/**
 * Timelock configuration for upgrade delays
 */
export interface TimelockConfig {
    /**
     * Minimum delay in seconds between scheduling and execution
     * Default: 86400 (24 hours)
     */
    minDelay?: number
    /**
     * Whether timelock deployment is enabled for this network
     */
    enabled?: boolean
}

/**
 * Role assignment configuration
 * If not specified, roles default to deployer address
 */
export interface RoleAssignments {
    /**
     * Address to receive DEFAULT_ADMIN_ROLE (should be multisig for mainnet)
     */
    defaultAdmin?: string
    /**
     * Address to receive ZOPAL_DEPOSIT_VAULT_ADMIN_ROLE
     */
    depositVaultAdmin?: string
    /**
     * Address to receive REDEMPTION_VAULT_ADMIN_ROLE
     */
    redemptionVaultAdmin?: string
    /**
     * Address to receive ZOPAL_PAUSE_OPERATOR_ROLE
     */
    pauseOperator?: string
    /**
     * Address to receive GREENLIST_OPERATOR_ROLE
     */
    greenlistOperator?: string
    /**
     * Address to receive BLACKLIST_OPERATOR_ROLE
     */
    blacklistOperator?: string
    /**
     * Address to receive PRICE_ADMIN_ROLE
     */
    priceAdmin?: string
    /**
     * Address to receive CONFIG_ROLE (PriceOracle)
     */
    configRole?: string
}

/**
 * Configuration for zVault protocol deployments
 */
export interface ZothDeploymentConfig extends BaseConfig {
    /**
     * Contract addresses - automatically populated during deployment
     */
    contractAddresses: ContractAddresses
    /**
     * Address where deposited tokens are collected (used by DepositVault)
     * Defaults to deployer address if not specified
     */
    tokensReceiver?: string
    /**
     * Address where all fees are collected (used by both vaults)
     * Defaults to deployer address if not specified
     */
    feeReceiver?: string
    /**
     * Sanctions checking contract address (optional)
     * Use zero address to disable. Defaults to zero address if not specified
     */
    sanctionsList?: string
    /**
     * Address that holds tokens for standard redemption requests (used by RedemptionVault)
     * This address must hold the tokens (USDC, USDT, etc.) that users want to redeem
     * Defaults to deployer address if not specified
     */
    requestRedeemer?: string
    /**
     * Role assignments - specify who should receive each role
     * If not specified, defaults to deployer (for testnet convenience)
     * For mainnet, these should be explicitly set to multisig addresses
     */
    roles?: RoleAssignments
    /**
     * If true, skip granting token operator roles (mint/burn/pause) to deployer
     * Use this for mainnet where deployer should never have these roles
     */
    skipDeployerTokenRoles?: boolean
    /**
     * Timelock configuration for upgrade delays
     */
    timelock?: TimelockConfig
}

export interface DeploymentResult {
    implementationAddress: string
    proxyAddress: string
    deploymentHash?: string
}

export interface VaultConfig {
    instantFee: number
    instantDailyLimit: bigint
    variationTolerance: number
    minAmount: bigint
    minZTokenAmountForFirstDeposit: bigint
    maxSupplyCap: bigint
}

export const CREATE3_FACTORY_ABI = [
    'function create(bytes32 _salt, bytes calldata _creationCode) external returns (address)',
    'function addressOf(bytes32 _salt) external view returns (address)'
] as const
