import { ethers } from 'hardhat'
import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { Logger } from '../utils/logger'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { network } = hre

    Logger.bigSeparator('=')
    Logger.log('🚀 ZOTH PROTOCOL - COMPLETE DEPLOYMENT')
    Logger.bigSeparator('=')

    const [deployer] = await ethers.getSigners()
    const startBalance = await ethers.provider.getBalance(deployer.address)

    Logger.log('Deployer', deployer.address)
    Logger.log('Network', network.name)
    Logger.log('Starting balance', ethers.formatEther(startBalance) + ' ETH')
    Logger.log('')

    const startTime = Date.now()

    try {
        // Note: This script serves as a master orchestrator
        // The actual deployment is handled by hardhat-deploy which will
        // automatically run all deploy scripts in order based on their dependencies

        Logger.log('All deployment scripts will be executed automatically by hardhat-deploy')
        Logger.log('Check individual deployment logs above for detailed status')

        // Final summary
        const endTime = Date.now()
        const endBalance = await ethers.provider.getBalance(deployer.address)
        const gasUsed = startBalance - endBalance

        Logger.log('')
        Logger.bigSeparator('=')
        Logger.log('✅ DEPLOYMENT COMPLETE!')
        Logger.bigSeparator('=')

        Logger.log('')
        Logger.log('📊 Deployment Statistics:')
        Logger.separator('-')
        Logger.log('Time taken', ((endTime - startTime) / 1000).toFixed(2) + ' seconds')
        Logger.log('Gas used', ethers.formatEther(gasUsed) + ' ETH')
        Logger.log('Final balance', ethers.formatEther(endBalance) + ' ETH')

        Logger.log('')
        Logger.log('📋 Next Steps:')
        Logger.separator('-')
        Logger.log('1. Verify contracts on block explorer')
        Logger.log('2. Set up monitoring for deployed contracts')
        Logger.log('3. Configure multi-sig for admin roles')
        Logger.log('4. Add payment tokens to the vault')
        Logger.log('5. Enable greenlist if required')
        Logger.log('6. Test deposit/mint flow')
        Logger.log('7. Check config/deployed/' + network.name + '.json for all addresses')
        Logger.log('')
        Logger.bigSeparator('=')

    } catch (error) {
        Logger.error('Deployment failed:', error)
        throw error
    }

    return true
}

export default func
func.tags = ['Complete']
func.id = 'deploy_all'
func.dependencies = ['ZothAccessControl', 'zHYPER', 'PriceOracle', 'ZHyperDepositVault', 'RedemptionVault']
func.runAtTheEnd = true
