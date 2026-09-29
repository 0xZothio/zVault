import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { confirmMag7Launch } from './lib/mag7'

/**
 * Prints MAG7 addresses and launch params, then waits for "yes" on live networks.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    await confirmMag7Launch(hre, hre.network.name)
    return true
}

export default func
func.tags = ['MAG7Confirm', 'MAG7']
func.dependencies = ['ZothAccessControl']
