export class Spinner {
    private static frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    private static interval: NodeJS.Timeout | null = null
    private static frameIndex = 0
    private static message = ''

    static start(message: string) {
        this.message = message
        this.frameIndex = 0
        
        // Clear any existing spinner
        if (this.interval) {
            clearInterval(this.interval)
        }

        // Start the spinner
        process.stdout.write(`  ${this.frames[0]} ${message}`)
        
        this.interval = setInterval(() => {
            this.frameIndex = (this.frameIndex + 1) % this.frames.length
            process.stdout.clearLine?.(0)
            process.stdout.cursorTo?.(0)
            process.stdout.write(`  ${this.frames[this.frameIndex]} ${this.message}`)
        }, 80)
    }

    static stop(success: boolean = true, finalMessage?: string) {
        if (this.interval) {
            clearInterval(this.interval)
            this.interval = null
        }
        
        process.stdout.clearLine?.(0)
        process.stdout.cursorTo?.(0)
        
        const icon = success ? '✓' : '✗'
        const msg = finalMessage || this.message
        console.log(`  ${icon}  ${msg}`)
    }

    static update(message: string) {
        this.message = message
    }
}

export class Logger {
    private static WIDTH = 80

    private static formatMessage(message: string, value?: string, indent: number = 0): string {
        const indentStr = '  '.repeat(indent)
        const paddedMessage = message.padEnd(50 - indent * 2)
        return value !== undefined ? `${indentStr}${paddedMessage}: ${value}` : `${indentStr}${message}`
    }

    private static centerText(text: string, width: number = Logger.WIDTH): string {
        const padding = Math.max(0, Math.floor((width - text.length) / 2))
        return ' '.repeat(padding) + text
    }

    static log(message: string, value?: string, indent: number = 0) {
        console.log(this.formatMessage(message, value, indent))
    }

    static info(message: string, value?: string, indent: number = 0) {
        console.log(`  ℹ  ${this.formatMessage(message, value, indent)}`)
    }

    static success(message: string, value?: string, indent: number = 0) {
        console.log(`  ✓  ${this.formatMessage(message, value, indent)}`)
    }

    static warning(message: string, value?: string, indent: number = 0) {
        console.log(`  ⚠  ${this.formatMessage(message, value, indent)}`)
    }

    static error(message: string, error?: any, indent: number = 0) {
        console.error(`  ✗  ${this.formatMessage(message, '', indent)}`)
        if (error) {
            if (error instanceof Error) {
                console.error(`      Error: ${error.message}`)
            } else {
                console.error(`      Details:`, error)
            }
        }
    }

    static separator(char = '─', length = Logger.WIDTH) {
        console.log(char.repeat(length))
    }

    static doubleSeparator(length = Logger.WIDTH) {
        console.log('═'.repeat(length))
    }

    static bigSeparator(char = '═', length = Logger.WIDTH) {
        console.log(char.repeat(length))
    }

    static header(title: string) {
        console.log('')
        this.doubleSeparator()
        console.log(`║  ${title.padEnd(Logger.WIDTH - 4)}║`)
        this.doubleSeparator()
    }

    static section(title: string) {
        console.log('')
        this.separator('─')
        console.log(`│  ${title}`)
        this.separator('─')
    }

    static subsection(title: string) {
        console.log('')
        console.log(`   ┌─ ${title}`)
    }

    static deploymentStart(contractName: string) {
        console.log('')
        this.separator('─')
        console.log(`│  📦 Deploying ${contractName}`)
        this.separator('─')
    }

    static deploymentSuccess(contractName: string, address: string) {
        this.success(`${contractName} deployed`, address)
    }

    static deploymentSkipped(contractName: string, address: string) {
        this.info(`${contractName} already deployed`, address)
    }

    static upgradeStart(contractName: string) {
        this.subsection(`Upgrading ${contractName}`)
    }

    static upgradeSuccess(contractName: string, newAddress: string) {
        this.success(`${contractName} upgraded`, newAddress)
    }

    static verificationStart(contractName: string, network: string) {
        this.log(`Verifying ${contractName} on ${network}...`, undefined, 1)
    }

    static verificationSuccess(contractName: string, network: string) {
        this.success(`${contractName} verified on ${network}`, undefined, 1)
    }

    static verificationSkipped(contractName: string, reason: string) {
        this.warning(`${contractName} verification skipped`, reason, 1)
    }

    static deploymentArgs(contractName: string, args: any[]) {
        console.log(`     Arguments for ${contractName}:`)
        args.forEach((arg, index) => {
            console.log(`       ${index + 1}. ${this.formatArg(arg)}`)
        })
    }

    private static formatArg(arg: any): string {
        if (typeof arg === 'string') {
            if (arg.startsWith('0x') && arg.length === 42) return arg
            if (arg.startsWith('0x') && arg.length === 66) return `${arg.substring(0, 10)}...${arg.substring(58)}`
            return `"${arg}"`
        }
        return String(arg)
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
        this.success(`${contractName} registered`, undefined, 1)
    }

    static registrationSkipped(contractName: string) {
        this.info(`${contractName} already registered`, undefined, 1)
    }

    static addressUpdated(contractName: string, address: string, network: string) {
        this.success(`${contractName} address saved`, `${address}`, 1)
    }

    static step(stepNumber: number, stepName: string, total?: number) {
        const progress = total ? ` [${stepNumber}/${total}]` : ''
        console.log('')
        console.log(`   → Step ${stepNumber}${progress}: ${stepName}`)
    }

    static roleGrant(roleName: string, address: string) {
        this.success(`${roleName} granted to`, address, 1)
    }

    static roleRevoke(roleName: string, address: string) {
        this.success(`${roleName} revoked from`, address, 1)
    }

    static roleAlreadyAssigned(roleName: string, address: string) {
        this.info(`${roleName} already assigned to ${address}`, undefined, 1)
    }

    static roleNotHeld(roleName: string, address: string) {
        this.info(`${roleName} not held by ${address.substring(0, 10)}...`, undefined, 1)
    }

    static banner(title: string) {
        console.log('')
        console.log('╔' + '═'.repeat(Logger.WIDTH - 2) + '╗')
        console.log('║' + this.centerText(title, Logger.WIDTH - 2) + '║')
        console.log('╚' + '═'.repeat(Logger.WIDTH - 2) + '╝')
        console.log('')
    }

    static summary(items: { label: string; value: string }[]) {
        console.log('')
        this.separator('─')
        items.forEach(item => {
            console.log(`  ${item.label.padEnd(40)}: ${item.value}`)
        })
        this.separator('─')
    }

    static clearConfigCache() {
        this.configLoadedNetworks.clear()
    }

    // Spinner helpers for long operations
    static startSpinner(message: string) {
        Spinner.start(message)
    }

    static stopSpinner(success: boolean = true, finalMessage?: string) {
        Spinner.stop(success, finalMessage)
    }

    // Async wrapper that shows spinner during operation
    static async withSpinner<T>(message: string, operation: () => Promise<T>): Promise<T> {
        Spinner.start(message)
        try {
            const result = await operation()
            Spinner.stop(true)
            return result
        } catch (error) {
            Spinner.stop(false, `${message} - Failed`)
            throw error
        }
    }
}
