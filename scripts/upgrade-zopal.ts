import { ethers } from "hardhat";
import * as fs from "fs";

/**
 * zOPAL Upgrade Script — Generates Remix IDE-friendly parameters
 * 
 * This script:
 *   1. Deploys the new zOPAL implementation (or uses existing one)
 *   2. Verifies it on BaseScan
 *   3. Prints individual function parameters for Remix IDE interaction
 * 
 * Usage:
 *   npx hardhat run scripts/upgrade-zopal.ts --network base
 *   IMPL=0xADDRESS npx hardhat run scripts/upgrade-zopal.ts --network base
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
    console.log("║      ZOPAL UPGRADE — REMIX IDE PARAMETERS            ║");
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

    // ========== Compute parameters ==========
    const proxyAdmin = await ethers.getContractAt("ProxyAdmin", PROXY_ADMIN);
    const timelock = await ethers.getContractAt("UpgradeTimelock", TIMELOCK_ADDR);
    const minDelay = await timelock.getMinDelay();

    // Salt — unique per implementation address
    const salt = ethers.id(`upgrade-zOPAL-${NEW_IMPL}`);

    // Encode initializeV2() — this is the "data" for upgradeAndCall
    const zOPALInterface = (await ethers.getContractFactory("zOPAL")).interface;
    const initV2Data = zOPALInterface.encodeFunctionData("initializeV2");

    // Encode ProxyAdmin.upgradeAndCall — this is the "data" for timelock.schedule/execute
    const upgradeCalldata = proxyAdmin.interface.encodeFunctionData("upgradeAndCall", [
        ZOPAL_PROXY,
        NEW_IMPL,
        initV2Data
    ]);

    // Compute operation ID
    const operationId = await timelock.hashOperation(
        PROXY_ADMIN, 0, upgradeCalldata, ethers.ZeroHash, salt
    );

    // ========== REMIX IDE OUTPUT ==========
    console.log("");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  STEP 1: DEPLOY IMPLEMENTATION");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("");
    console.log("  ✅ Done! New implementation: " + NEW_IMPL);
    console.log("");

    console.log("═══════════════════════════════════════════════════════════");
    console.log("  STEP 2: SCHEDULE UPGRADE (Remix IDE)");
    console.log("  Wallet: Nav Change (0x15925A7571f5bD7CE67EeeddFAA31136E565683e)");
    console.log("  Contract: UpgradeTimelock");
    console.log(`  At: ${TIMELOCK_ADDR}`);
    console.log("  Function: schedule");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("");
    console.log("  Paste these values into Remix IDE:");
    console.log("");
    console.log(`  target:      ${PROXY_ADMIN}`);
    console.log(`  value:       0`);
    console.log(`  data:        ${upgradeCalldata}`);
    console.log(`  predecessor: ${ethers.ZeroHash}`);
    console.log(`  salt:        ${salt}`);
    console.log(`  delay:       ${minDelay}`);
    console.log("");

    console.log("═══════════════════════════════════════════════════════════");
    console.log("  STEP 3: CHECK STATUS (Remix IDE or BaseScan)");
    console.log("  Contract: UpgradeTimelock");
    console.log(`  At: ${TIMELOCK_ADDR}`);
    console.log("  Function: isOperationReady (Read)");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("");
    console.log(`  id:          ${operationId}`);
    console.log("");
    console.log("  Returns true → ready to execute");
    console.log("");

    console.log("═══════════════════════════════════════════════════════════");
    console.log("  STEP 4: EXECUTE UPGRADE (Remix IDE) — After 24 hours!");
    console.log("  Wallet: Super Admin (0x973Bd2510d866b1F2494c97ca9fd9595037B2F04)");
    console.log("  Contract: UpgradeTimelock");
    console.log(`  At: ${TIMELOCK_ADDR}`);
    console.log("  Function: execute");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("");
    console.log("  Paste these values into Remix IDE:");
    console.log("");
    console.log(`  target:      ${PROXY_ADMIN}`);
    console.log(`  value:       0`);
    console.log(`  payload:     ${upgradeCalldata}`);
    console.log(`  predecessor: ${ethers.ZeroHash}`);
    console.log(`  salt:        ${salt}`);
    console.log("");

    console.log("═══════════════════════════════════════════════════════════");
    console.log("  EMERGENCY: CANCEL (Remix IDE)");
    console.log("  Wallet: Super Admin (0x973Bd2510d866b1F2494c97ca9fd9595037B2F04)");
    console.log("  Contract: UpgradeTimelock");
    console.log(`  At: ${TIMELOCK_ADDR}`);
    console.log("  Function: cancel");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("");
    console.log(`  id:          ${operationId}`);
    console.log("");

    console.log("═══════════════════════════════════════════════════════════");
    console.log("  STEP 5: VERIFY UPGRADE (Remix IDE or BaseScan)");
    console.log("  Contract: ProxyAdmin");
    console.log(`  At: ${PROXY_ADMIN}`);
    console.log("  Function: getProxyImplementation (Read)");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("");
    console.log(`  proxy:       ${ZOPAL_PROXY}`);
    console.log(`  Expected:    ${NEW_IMPL}`);
    console.log("");

    // ========== Save to file ==========
    const outputFile = `./upgrade-zopal-${Date.now()}.json`;
    const output = {
        network: "base",
        chainId: Number(network.chainId),
        timestamp: new Date().toISOString(),
        newImplementation: NEW_IMPL,
        operationId,
        salt,
        minDelay: Number(minDelay),
        remix: {
            schedule: {
                contract: "UpgradeTimelock",
                address: TIMELOCK_ADDR,
                function: "schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)",
                wallet: "0x15925A7571f5bD7CE67EeeddFAA31136E565683e",
                params: {
                    target: PROXY_ADMIN,
                    value: "0",
                    data: upgradeCalldata,
                    predecessor: ethers.ZeroHash,
                    salt: salt,
                    delay: Number(minDelay).toString()
                }
            },
            execute: {
                contract: "UpgradeTimelock",
                address: TIMELOCK_ADDR,
                function: "execute(address target, uint256 value, bytes payload, bytes32 predecessor, bytes32 salt)",
                wallet: "0x973Bd2510d866b1F2494c97ca9fd9595037B2F04",
                params: {
                    target: PROXY_ADMIN,
                    value: "0",
                    payload: upgradeCalldata,
                    predecessor: ethers.ZeroHash,
                    salt: salt
                }
            },
            cancel: {
                contract: "UpgradeTimelock",
                address: TIMELOCK_ADDR,
                function: "cancel(bytes32 id)",
                wallet: "0x973Bd2510d866b1F2494c97ca9fd9595037B2F04",
                params: {
                    id: operationId
                }
            },
            checkStatus: {
                contract: "UpgradeTimelock",
                address: TIMELOCK_ADDR,
                function: "isOperationReady(bytes32 id)",
                params: {
                    id: operationId
                }
            },
            verify: {
                contract: "ProxyAdmin",
                address: PROXY_ADMIN,
                function: "getProxyImplementation(address proxy)",
                params: {
                    proxy: ZOPAL_PROXY
                },
                expectedResult: NEW_IMPL
            }
        }
    };

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
    console.log(`💾 Saved to: ${outputFile}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
