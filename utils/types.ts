export interface BaseConfig {
    network: string
    chainId: number
}

export interface AdminRoles {
    gatekeeperAdmin: string
    orchestratorAdmin: string
    guardianAdmin: string
    treasuryAdmin: string
}

export interface OperationalRoles {
    gatekeeper: string
    orchestrator: string
    guardian: string
    treasury: string
    whitelister: string
}

export interface ContractAddresses {
    [key: string]: string
}

export interface MidasDeploymentConfig extends BaseConfig {
    adminRoles: AdminRoles
    operationalRoles: OperationalRoles
    contractAddresses: ContractAddresses
    tokensReceiver?: string
    feeReceiver?: string
    sanctionsList?: string
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
