import { ethers } from "hardhat";
import * as fs from "fs";

/**
 * zOPAL Upgrade Script
 * 
 * This script:
 *   1. Deploys the new zOPAL implementation (or uses existing one)
 *   2. Verifies it on BaseScan
 *   3. Generates ALL calldata needed for the timelock upgrade
 *   4. Saves everything to a JSON file for reference
 * 
 * Usage:
 *   npx hardhat run scripts/upgrade-zopal.ts --network base                                          # deploy new impl
 *   IMPL=0xADDRESS npx hardhat run scripts/upgrade-zopal.ts --network base                           # use existing impl
 */

// ============================================================
// ADDRESSES — Update these if they change
// ============================================================
const PROXY_ADMIN   = ethers.getAddress("0x5A9916C8B89F4Cc97B782d5138Ea54A17EB79b84");
const ZOPAL_PROXY   = ethers.getAddress("0x2E9705d95f1624faB9CAAba775234571BD557f24");
const TIMELOCK_ADDR = ethers.getAddress("0xff082079c027f01d61045b8eceafab92ddfd6856");

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log("╔═══════════════════════════════════════════════════════╗");
    console.log("║        ZOPAL UPGRADE — DEPLOY + GENERATE CALLDATA    ║");
    console.log("╚═══════════════════════════════════════════════════════╝");
    console.log("");
    console.log(`  Network:     ${network.chainId}`);
    console.log(`  Deployer:    ${deployer.address}`);
    console.log(`  ProxyAdmin:  ${PROXY_ADMIN}`);
    console.log(`  zOPAL Proxy: ${ZOPAL_PROXY}`);
    console.log(`  Timelock:    ${TIMELOCK_ADDR}`);
    console.log("");

    // ========== Deploy or use existing implementation ==========
    let NEW_IMPL: string;

    if (process.env.IMPL) {
        NEW_IMPL = ethers.getAddress(process.env.IMPL);
        console.log("─── Using existing zOPAL implementation ───");
        console.log(`  ✅ Implementation: ${NEW_IMPL}`);
        console.log("");
    } else {
        console.log("─── Deploying new zOPAL implementation ───");
        console.log("");

        const zOPALFactory = await ethers.getContractFactory("zOPAL");
        console.log("  Deploying...");
        const newImpl = await zOPALFactory.deploy();
        await newImpl.waitForDeployment();
        NEW_IMPL = await newImpl.getAddress();
        console.log(`  ✅ New zOPAL implementation deployed: ${NEW_IMPL}`);
        console.log("");

        // Verify
        try {
            console.log("  Verifying on block explorer...");
            await require("hardhat").run("verify:verify", {
                address: NEW_IMPL,
                constructorArguments: []
            });
            console.log("  ✅ Verified!");
        } catch (error: any) {
            if (error.message.includes("Already Verified") || error.message.includes("already verified")) {
                console.log("  ✅ Already verified");
            } else {
                console.log("  ⚠️  Verification failed — verify manually:");
                console.log(`     npx hardhat verify --network base ${NEW_IMPL}`);
            }
        }
        console.log("");
    }

    // ========== Generate all calldata ==========
    console.log("─── Generating calldata ───");
    console.log("");

    const proxyAdmin = await ethers.getContractAt("ProxyAdmin", PROXY_ADMIN);
    const timelock = await ethers.getContractAt("UpgradeTimelock", TIMELOCK_ADDR);
    const minDelay = await timelock.getMinDelay();

    // Unique salt for this upgrade
    const salt = ethers.id(`upgrade-zOPAL-${NEW_IMPL}`);

    // 1. ProxyAdmin.upgrade(proxy, newImpl) — this is what the timelock will call
    const upgradeCalldata = proxyAdmin.interface.encodeFunctionData("upgrade", [
        ZOPAL_PROXY,
        NEW_IMPL
    ]);

    // 2. Timelock.schedule(...) — Nav Change (PROPOSER) will call this
    const scheduleCalldata = timelock.interface.encodeFunctionData("schedule", [
        PROXY_ADMIN,        // target
        0,                  // value
        upgradeCalldata,    // data
        ethers.ZeroHash,    // predecessor
        salt,               // salt
        minDelay            // delay
    ]);

    // 3. Operation ID — for status checks
    const operationId = await timelock.hashOperation(
        PROXY_ADMIN, 0, upgradeCalldata, ethers.ZeroHash, salt
    );

    // 4. Timelock.execute(...) — Super Admin (EXECUTOR) will call this after 24h
    const executeCalldata = timelock.interface.encodeFunctionData("execute", [
        PROXY_ADMIN,        // target
        0,                  // value
        upgradeCalldata,    // payload
        ethers.ZeroHash,    // predecessor
        salt                // salt
    ]);

    // 5. Timelock.cancel(id) — Super Admin (CANCELLER) can abort
    const cancelCalldata = timelock.interface.encodeFunctionData("cancel", [operationId]);

    // ========== Output ==========
    console.log("╔═══════════════════════════════════════════════════════╗");
    console.log("║  NAV CHANGE (0x1592...) CALLS schedule()   ║");
    console.log("╠═══════════════════════════════════════════════════════╣");
    console.log("║                                                       ║");
    console.log("║  Submit via Safe / MPC wallet:                        ║");
    console.log("╚═══════════════════════════════════════════════════════╝");
    console.log("");
    console.log(`  TO:    ${TIMELOCK_ADDR}`);
    console.log(`  VALUE: 0`);
    console.log(`  DATA:`);
    console.log(`  ${scheduleCalldata}`);
    console.log("");

    console.log("  Safe Transaction JSON:");
    console.log(JSON.stringify({
        to: TIMELOCK_ADDR,
        value: "0",
        data: scheduleCalldata,
        operation: 0
    }, null, 2));
    console.log("");

    console.log("╔═══════════════════════════════════════════════════════╗");
    console.log("║  SUPER ADMIN (0x973B...) CALLS execute()   ║");
    console.log("║  ⏰ Only after 24 hours!                              ║");
    console.log("╠═══════════════════════════════════════════════════════╣");
    console.log("║                                                       ║");
    console.log("║  Submit via Safe / MPC wallet:                        ║");
    console.log("╚═══════════════════════════════════════════════════════╝");
    console.log("");
    console.log(`  TO:    ${TIMELOCK_ADDR}`);
    console.log(`  VALUE: 0`);
    console.log(`  DATA:`);
    console.log(`  ${executeCalldata}`);
    console.log("");

    console.log("  Safe Transaction JSON:");
    console.log(JSON.stringify({
        to: TIMELOCK_ADDR,
        value: "0",
        data: executeCalldata,
        operation: 0
    }, null, 2));
    console.log("");

    console.log("╔═══════════════════════════════════════════════════════╗");
    console.log("║  EMERGENCY — SUPER ADMIN CALLS cancel()              ║");
    console.log("╚═══════════════════════════════════════════════════════╝");
    console.log("");
    console.log(`  TO:    ${TIMELOCK_ADDR}`);
    console.log(`  VALUE: 0`);
    console.log(`  DATA:  ${cancelCalldata}`);
    console.log("");

    console.log("╔═══════════════════════════════════════════════════════╗");
    console.log("║  CHECK STATUS (anyone can read)                       ║");
    console.log("╚═══════════════════════════════════════════════════════╝");
    console.log("");
    console.log(`  On BaseScan → UpgradeTimelock → Read Contract:`);
    console.log(`  ${`https://basescan.org/address/${TIMELOCK_ADDR}#readContract`}`);
    console.log("");
    console.log(`  Call isOperationReady with:`);
    console.log(`  id: ${operationId}`);
    console.log(`  Returns true → ready to execute`);
    console.log("");

    console.log("╔═══════════════════════════════════════════════════════╗");
    console.log("║  VERIFY AFTER EXECUTION (anyone can read)             ║");
    console.log("╚═══════════════════════════════════════════════════════╝");
    console.log("");
    console.log(`  On BaseScan → ProxyAdmin → Read Contract:`);
    console.log(`  ${`https://basescan.org/address/${PROXY_ADMIN}#readContract`}`);
    console.log("");
    console.log(`  Call getProxyImplementation with:`);
    console.log(`  proxy: ${ZOPAL_PROXY}`);
    console.log(`  Should return: ${NEW_IMPL}`);
    console.log("");

    // Save everything to a file
    const outputFile = `./upgrade-zopal-${Date.now()}.json`;
    const output = {
        network: "base",
        chainId: Number(network.chainId),
        timestamp: new Date().toISOString(),
        addresses: {
            proxyAdmin: PROXY_ADMIN,
            zopalProxy: ZOPAL_PROXY,
            timelock: TIMELOCK_ADDR,
            newImplementation: NEW_IMPL
        },
        operationId,
        salt,
        minDelay: Number(minDelay),
        minDelayHours: Number(minDelay) / 3600,
        calldata: {
            schedule: {
                description: "Nav Change (PROPOSER) submits this to Timelock",
                to: TIMELOCK_ADDR,
                value: "0",
                data: scheduleCalldata
            },
            execute: {
                description: "Super Admin (EXECUTOR) submits this after 24h delay",
                to: TIMELOCK_ADDR,
                value: "0",
                data: executeCalldata
            },
            cancel: {
                description: "Super Admin (CANCELLER) submits this to abort",
                to: TIMELOCK_ADDR,
                value: "0",
                data: cancelCalldata
            }
        },
        statusCheck: {
            description: "Call isOperationReady on Timelock with this operationId",
            contract: TIMELOCK_ADDR,
            function: "isOperationReady(bytes32)",
            operationId: operationId
        },
        verification: {
            description: "Call getProxyImplementation on ProxyAdmin after execution",
            contract: PROXY_ADMIN,
            function: "getProxyImplementation(address)",
            proxy: ZOPAL_PROXY,
            expectedResult: NEW_IMPL
        }
    };

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
    console.log(`💾 All data saved to: ${outputFile}`);
    console.log("");

    console.log("╔═══════════════════════════════════════════════════════╗");
    console.log("║  SUMMARY OF NEXT STEPS                               ║");
    console.log("╠═══════════════════════════════════════════════════════╣");
    console.log("║                                                       ║");
    console.log("║  1. Nav Change (0x1592...) → schedule() via Safe/MPC  ║");
    console.log("║  2. Wait 24 hours                                     ║");
    console.log("║  3. Check: isOperationReady(operationId) == true      ║");
    console.log("║  4. Super Admin (0x973B...) → execute() via Safe/MPC  ║");
    console.log("║  5. Verify: getProxyImplementation == new impl        ║");
    console.log("║                                                       ║");
    console.log("╚═══════════════════════════════════════════════════════╝");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
