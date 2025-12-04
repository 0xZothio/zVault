import * as fs from 'fs'
import * as path from 'path'

import { NetworkConfig } from './types'

export class Config {
    private static configPath = path.join(__dirname, '../config/deployments.json')

    static load(chainId: number): NetworkConfig {
        const configs = JSON.parse(fs.readFileSync(this.configPath, 'utf8'))
        const config = configs[chainId]

        if (!config) {
            throw new Error(`Config not found for chain ID ${chainId}`)
        }

        return config
    }

    static loadAll(): { [key: string]: NetworkConfig } {
        return JSON.parse(fs.readFileSync(this.configPath, 'utf8'))
    }

    static update(chainId: number, updates: Partial<NetworkConfig>): void {
        const configs = this.loadAll()
        configs[chainId] = {
            ...configs[chainId],
            ...updates
        }

        fs.writeFileSync(this.configPath, JSON.stringify(configs, null, 2))
    }

    static validate(chainId: number, requiredFields: (keyof NetworkConfig)[]): void {
        const config = this.load(chainId)

        for (const field of requiredFields) {
            if (!config[field]) {
                throw new Error(`Missing required config field: ${field}`)
            }
        }
    }

    static validateChain(chainId: number): void {
        if (!this.loadAll()[chainId]) {
            throw new Error(`Config not found for chain ID ${chainId}`)
        }
    }
}
