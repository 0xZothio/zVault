export interface BaseConfig {
    network: string
    chainId: number
}

export interface ContractAddresses {
    [key: string]: string
}

/**
 * Configuration for zVault protocol deployments
 */
export interface MidasDeploymentConfig extends BaseConfig {
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
    minMTokenAmountForFirstDeposit: bigint
    maxSupplyCap: bigint
}

export const CREATE3_FACTORY_ABI = [
    'function create(bytes32 _salt, bytes calldata _creationCode) external returns (address)',
    'function addressOf(bytes32 _salt) external view returns (address)'
] as const
