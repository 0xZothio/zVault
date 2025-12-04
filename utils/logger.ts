export class Logger {
    private static formatMessage(message: string, value?: string, indent: number = 0): string {
        const indentStr = '  '.repeat(indent)
        return value ? `${indentStr}${message.padEnd(50 - indent * 2)} : ${value}` : `${indentStr}${message}`
    }

    private static formatAddress(address: string): string {
        // For addresses, show first 6 and last 4 characters
        if (address.length === 42 && address.startsWith('0x')) {
            return `${address.substring(0, 6)}...${address.substring(38)}`
        }
        return address
    }

    private static formatArgument(arg: any, index: number): string {
        let formattedArg: string

        if (typeof arg === 'string') {
            if (arg.startsWith('0x') && arg.length === 42) {
                // Address
                formattedArg = arg
            } else if (arg.startsWith('0x') && arg.length === 66) {
                // Hash (like merkle root)
                formattedArg = arg.length > 20 ? `${arg.substring(0, 10)}...${arg.substring(58)}` : arg
            } else {
                // Regular string
                formattedArg = `"${arg}"`
            }
        } else if (typeof arg === 'number' || typeof arg === 'bigint') {
            formattedArg = arg.toString()
        } else {
            formattedArg = String(arg)
        }

        return `${index + 1}. ${formattedArg}`
    }

    static log(message: string, value?: string, indent: number = 0) {
        console.log(this.formatMessage(message, value, indent))
    }

    static info(message: string, value?: string, indent: number = 0) {
        console.log(`ℹ️  ${this.formatMessage(message, value, indent)}`)
    }

    static success(message: string, value?: string, indent: number = 0) {
        console.log(`✅ ${this.formatMessage(message, value, indent)}`)
    }

    static warning(message: string, value?: string, indent: number = 0) {
        console.log(`⚠️  ${this.formatMessage(message, value, indent)}`)
    }

    static error(message: string, error?: any, indent: number = 0) {
        console.error(`❌ ${this.formatMessage(message, '', indent)}`)
        if (error) {
            if (error instanceof Error) {
                console.error(`   ${''.padStart(indent * 2)}Error: ${error.message}`)
                if (process.env.NODE_ENV === 'development' && error.stack) {
                    console.error(`   ${''.padStart(indent * 2)}Stack: ${error.stack}`)
                }
            } else {
                console.error(`   ${''.padStart(indent * 2)}Details:`, error)
            }
        }
    }

    static separator(char = '-', length = 80) {
        console.log(char.repeat(length))
    }

    static bigSeparator(char = '=', length = 80) {
        console.log(char.repeat(length))
    }

    static section(title: string) {
        console.log('')
        this.bigSeparator('=')
        console.log(`🚀 ${title}`)
        this.bigSeparator('=')
    }

    static subsection(title: string) {
        console.log('')
        this.separator('-')
        console.log(`📋 ${title}`)
        this.separator('-')
    }

    static deploymentStart(contractName: string) {
        this.subsection(`Deploying ${contractName}`)
    }

    static deploymentSuccess(contractName: string, address: string) {
        this.success(`${contractName} deployed successfully`, address)
    }

    static deploymentSkipped(contractName: string, address: string) {
        this.info(`${contractName} already deployed`, address)
    }

    static upgradeStart(contractName: string) {
        this.subsection(`Upgrading ${contractName}`)
    }

    static upgradeSuccess(contractName: string, newAddress: string) {
        this.success(`${contractName} upgraded successfully`, newAddress)
    }

    static verificationStart(contractName: string, network: string) {
        this.log(`Verifying ${contractName} on ${network}...`, undefined, 1)
    }

    static verificationSuccess(contractName: string, network: string) {
        this.success(`${contractName} verified on ${network}`, undefined, 1)
    }

    static verificationSkipped(contractName: string, reason: string) {
        this.info(`${contractName} verification skipped: ${reason}`, undefined, 1)
    }

    static deploymentArgs(contractName: string, args: any[]) {
        console.log(`  Deployment arguments for ${contractName}:`)
        args.forEach((arg, index) => {
            console.log(`    ${this.formatArgument(arg, index)}`)
        })
    }

    private static configLoadedNetworks = new Set<string>()

    static configLoaded(network: string, isExisting: boolean = false) {
        if (this.configLoadedNetworks.has(network)) return

        this.configLoadedNetworks.add(network)
        this.info(`Configuration loaded for network: ${network}`)
        if (isExisting) {
            this.info(`Found existing deployment data`, undefined, 1)
        }
    }

    static registrationStart(contractName: string) {
        this.log(`Registering ${contractName}...`, undefined, 1)
    }

    static registrationSuccess(contractName: string) {
        this.success(`${contractName} registered successfully`, undefined, 1)
    }

    static registrationSkipped(contractName: string) {
        this.info(`${contractName} already registered`, undefined, 1)
    }

    static addressUpdated(contractName: string, address: string, network: string) {
        this.success(`${contractName} address updated`, `${address} (${network})`, 1)
    }

    static step(stepNumber: number, stepName: string, total?: number) {
        const progress = total ? ` (${stepNumber}/${total})` : ''
        console.log('')
        this.log(`🔄 Step ${stepNumber}${progress}: ${stepName}`)
    }

    static clearConfigCache() {
        this.configLoadedNetworks.clear()
    }
}
