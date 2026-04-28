import * as hre from 'hardhat'

import { Logger } from './logger'

export class Verifier {
    static async verifyContract(
        address: string,
        contract: string,
        constructorArguments: any[] = [],
        libraries: Record<string, string> = {}
    ): Promise<boolean> {
        try {
            // Skip verification for local networks
            if (hre.network.name === 'hardhat' || hre.network.name === 'localhost') {
                Logger.log('Skipping verification on local network')
                return true
            }

            // Check if already verified
            try {
                const isVerified = await hre.run('verify:verify', { address })
                if (isVerified) {
                    Logger.log(`Contract ${contract} is already verified at ${address}`)
                    return true
                }
            } catch (e) {
                // Continue with verification if contract is not verified
            }

            // Attempt verification
            await hre.run('verify:verify', {
                address,
                contract,
                constructorArguments,
                libraries
            })

            Logger.log(`Contract ${contract} verified successfully at ${address}`)
            return true
        } catch (error) {
            Logger.error(`Error verifying ${contract}:`, error)

            // Log manual verification data
            Logger.log('\nManual Verification Data:')
            Logger.log('Address', address)
            Logger.log('Contract', contract)
            Logger.log('Constructor Arguments', JSON.stringify(constructorArguments))

            if (constructorArguments.length > 0) {
                const encoded = hre.ethers.AbiCoder.defaultAbiCoder().encode(
                    ['address', 'bytes'],
                    constructorArguments
                )
                Logger.log('ABI-encoded Constructor Arguments', encoded)
            }

            return false
        }
    }

    static async verifyImplementationAndProxy(
        implementationAddress: string,
        proxyAddress: string,
        implementationContract: string,
        proxyContract: string,
        implementationArgs: any[] = [],
        proxyArgs: any[] = []
    ): Promise<void> {
        // Verify implementation first
        await this.verifyContract(implementationAddress, implementationContract, implementationArgs)

        // Then verify proxy
        await this.verifyContract(proxyAddress, proxyContract, proxyArgs)
    }
}
