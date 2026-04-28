import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Test suite covering end-to-end timelock upgrade of zOPAL:
 * - Deploy zOPAL with old name ("zOPAL", "zOPAL") via TransparentProxy + ProxyAdmin
 * - Deploy UpgradeTimelock, transfer ProxyAdmin ownership to it
 * - Fix CANCELLER_ROLE (revoke from proposer, grant to executor)
 * - Deploy new zOPAL implementation (with initializeV2)
 * - Proposer schedules upgradeAndCall through timelock
 * - Verify: cannot execute before delay
 * - Fast-forward 24 hours, executor executes
 * - Verify: name changed, symbol unchanged, balances preserved, roles intact
 * - Verify: initializeV2 cannot be called again
 * - Verify: non-proposer cannot schedule, non-executor cannot execute
 * - Verify: canceller can cancel a scheduled upgrade
 */
describe("Timelock Upgrade — zOPAL Name Change", function () {
    const MIN_DELAY = 86400; // 24 hours

    async function deployTimelockUpgradeFixture() {
        const [deployer, proposer, executor, user, unauthorizedUser] = await ethers.getSigners();

        // ── Deploy ZothAccessControl ──
        const AccessControlFactory = await ethers.getContractFactory("ZothAccessControl");
        const accessControlImpl = await AccessControlFactory.deploy();
        const initData = accessControlImpl.interface.encodeFunctionData("initialize", []);

        const ERC1967ProxyFactory = await ethers.getContractFactory(
            "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"
        );
        const accessControlProxy = await ERC1967ProxyFactory.deploy(
            await accessControlImpl.getAddress(), initData
        );
        const accessControl = AccessControlFactory.attach(await accessControlProxy.getAddress()) as any;

        // ── Deploy zOPAL (old: name="zOPAL", symbol="zOPAL") via Transparent Proxy ──
        const zOPALFactory = await ethers.getContractFactory("zOPAL");
        const zOPALImpl = await zOPALFactory.deploy();

        const zOPALInitData = zOPALImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            ethers.ZeroAddress
        ]);

        // Deploy ProxyAdmin
        const ProxyAdminFactory = await ethers.getContractFactory(
            "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol:ProxyAdmin"
        );
        const proxyAdmin = await ProxyAdminFactory.deploy();

        // Deploy TransparentUpgradeableProxy
        const TransparentProxyFactory = await ethers.getContractFactory(
            "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy"
        );
        const zOPALProxy = await TransparentProxyFactory.deploy(
            await zOPALImpl.getAddress(),
            await proxyAdmin.getAddress(),
            zOPALInitData
        );

        const zToken = zOPALFactory.attach(await zOPALProxy.getAddress()) as any;

        // Mint some tokens to user for state preservation checks
        const ZOPAL_MINT_OPERATOR_ROLE = await accessControl.ZOPAL_MINT_OPERATOR_ROLE();
        await accessControl.grantRole(ZOPAL_MINT_OPERATOR_ROLE, await deployer.getAddress());
        await zToken.mint(await user.getAddress(), ethers.parseUnits("5000", 18));

        // ── Deploy UpgradeTimelock ──
        const TimelockFactory = await ethers.getContractFactory("UpgradeTimelock");
        const timelock = await TimelockFactory.deploy(
            MIN_DELAY,
            [await proposer.getAddress()],  // proposers
            [await executor.getAddress()],  // executors
            await deployer.getAddress()     // admin (can manage roles)
        );

        // Fix CANCELLER_ROLE: grant to executor, revoke from proposer
        const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
        await timelock.grantRole(CANCELLER_ROLE, await executor.getAddress());
        await timelock.revokeRole(CANCELLER_ROLE, await proposer.getAddress());

        // Transfer ProxyAdmin ownership to timelock
        await proxyAdmin.transferOwnership(await timelock.getAddress());

        return {
            zToken, zOPALImpl, zOPALProxy, proxyAdmin, timelock,
            accessControl, zOPALFactory,
            deployer, proposer, executor, user, unauthorizedUser
        };
    }

    describe("Pre-upgrade state", function () {
        it("zOPAL has old name and symbol", async function () {
            const { zToken } = await loadFixture(deployTimelockUpgradeFixture);
            expect(await zToken.name()).to.equal("zOPAL");
            expect(await zToken.symbol()).to.equal("zOPAL");
        });

        it("ProxyAdmin is owned by the timelock", async function () {
            const { proxyAdmin, timelock } = await loadFixture(deployTimelockUpgradeFixture);
            expect(await proxyAdmin.owner()).to.equal(await timelock.getAddress());
        });

        it("Timelock roles are correctly assigned", async function () {
            const { timelock, proposer, executor } = await loadFixture(deployTimelockUpgradeFixture);

            const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
            const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
            const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();

            expect(await timelock.hasRole(PROPOSER_ROLE, await proposer.getAddress())).to.be.true;
            expect(await timelock.hasRole(EXECUTOR_ROLE, await executor.getAddress())).to.be.true;
            expect(await timelock.hasRole(CANCELLER_ROLE, await executor.getAddress())).to.be.true;
            // Proposer should NOT have CANCELLER_ROLE
            expect(await timelock.hasRole(CANCELLER_ROLE, await proposer.getAddress())).to.be.false;
        });
    });

    describe("Timelock upgrade flow — happy path", function () {
        it("Full upgrade: schedule → wait → execute → name changed, state preserved", async function () {
            const { zToken, proxyAdmin, timelock, zOPALProxy, zOPALFactory, proposer, executor, user } =
                await loadFixture(deployTimelockUpgradeFixture);

            // Record pre-upgrade state
            const balanceBefore = await zToken.balanceOf(await user.getAddress());
            const totalSupplyBefore = await zToken.totalSupply();
            expect(await zToken.name()).to.equal("zOPAL");

            // Deploy new implementation
            const newImpl = await zOPALFactory.deploy();
            const newImplAddress = await newImpl.getAddress();

            // Encode upgradeAndCall with initializeV2()
            const initV2Data = zOPALFactory.interface.encodeFunctionData("initializeV2");
            const upgradeCalldata = proxyAdmin.interface.encodeFunctionData("upgradeAndCall", [
                await zOPALProxy.getAddress(),
                newImplAddress,
                initV2Data
            ]);

            const salt = ethers.id("upgrade-zOPAL-v2-test");
            const proxyAdminAddress = await proxyAdmin.getAddress();

            // Proposer schedules the upgrade
            await timelock.connect(proposer).schedule(
                proxyAdminAddress,
                0,
                upgradeCalldata,
                ethers.ZeroHash,
                salt,
                MIN_DELAY
            );

            // Verify operation is pending
            const operationId = await timelock.hashOperation(
                proxyAdminAddress, 0, upgradeCalldata, ethers.ZeroHash, salt
            );
            expect(await timelock.isOperationPending(operationId)).to.be.true;
            expect(await timelock.isOperationReady(operationId)).to.be.false;

            // Fast-forward 24 hours
            await time.increase(MIN_DELAY);

            // Now it should be ready
            expect(await timelock.isOperationReady(operationId)).to.be.true;

            // Executor executes the upgrade
            await timelock.connect(executor).execute(
                proxyAdminAddress,
                0,
                upgradeCalldata,
                ethers.ZeroHash,
                salt
            );

            // Verify operation is done
            expect(await timelock.isOperationDone(operationId)).to.be.true;

            // Verify name changed, symbol unchanged
            expect(await zToken.name()).to.equal("Zoth BlackOpal");
            expect(await zToken.symbol()).to.equal("zOPAL");

            // Verify state preserved
            expect(await zToken.balanceOf(await user.getAddress())).to.equal(balanceBefore);
            expect(await zToken.totalSupply()).to.equal(totalSupplyBefore);
        });
    });

    describe("Timelock constraints", function () {
        it("Cannot execute before delay expires", async function () {
            const { proxyAdmin, timelock, zOPALProxy, zOPALFactory, proposer, executor } =
                await loadFixture(deployTimelockUpgradeFixture);

            const newImpl = await zOPALFactory.deploy();
            const initV2Data = zOPALFactory.interface.encodeFunctionData("initializeV2");
            const upgradeCalldata = proxyAdmin.interface.encodeFunctionData("upgradeAndCall", [
                await zOPALProxy.getAddress(),
                await newImpl.getAddress(),
                initV2Data
            ]);

            const salt = ethers.id("upgrade-early-test");
            const proxyAdminAddress = await proxyAdmin.getAddress();

            await timelock.connect(proposer).schedule(
                proxyAdminAddress, 0, upgradeCalldata, ethers.ZeroHash, salt, MIN_DELAY
            );

            // Try to execute immediately — should revert
            await expect(
                timelock.connect(executor).execute(
                    proxyAdminAddress, 0, upgradeCalldata, ethers.ZeroHash, salt
                )
            ).to.be.revertedWith("TimelockController: operation is not ready");
        });

        it("Non-proposer cannot schedule upgrade", async function () {
            const { proxyAdmin, timelock, zOPALProxy, zOPALFactory, unauthorizedUser } =
                await loadFixture(deployTimelockUpgradeFixture);

            const newImpl = await zOPALFactory.deploy();
            const initV2Data = zOPALFactory.interface.encodeFunctionData("initializeV2");
            const upgradeCalldata = proxyAdmin.interface.encodeFunctionData("upgradeAndCall", [
                await zOPALProxy.getAddress(),
                await newImpl.getAddress(),
                initV2Data
            ]);

            const salt = ethers.id("upgrade-unauthorized-schedule");

            await expect(
                timelock.connect(unauthorizedUser).schedule(
                    await proxyAdmin.getAddress(), 0, upgradeCalldata, ethers.ZeroHash, salt, MIN_DELAY
                )
            ).to.be.reverted;
        });

        it("Non-executor cannot execute upgrade", async function () {
            const { proxyAdmin, timelock, zOPALProxy, zOPALFactory, proposer, unauthorizedUser } =
                await loadFixture(deployTimelockUpgradeFixture);

            const newImpl = await zOPALFactory.deploy();
            const initV2Data = zOPALFactory.interface.encodeFunctionData("initializeV2");
            const upgradeCalldata = proxyAdmin.interface.encodeFunctionData("upgradeAndCall", [
                await zOPALProxy.getAddress(),
                await newImpl.getAddress(),
                initV2Data
            ]);

            const salt = ethers.id("upgrade-unauthorized-execute");
            const proxyAdminAddress = await proxyAdmin.getAddress();

            await timelock.connect(proposer).schedule(
                proxyAdminAddress, 0, upgradeCalldata, ethers.ZeroHash, salt, MIN_DELAY
            );

            await time.increase(MIN_DELAY);

            await expect(
                timelock.connect(unauthorizedUser).execute(
                    proxyAdminAddress, 0, upgradeCalldata, ethers.ZeroHash, salt
                )
            ).to.be.reverted;
        });

        it("Direct ProxyAdmin.upgrade bypassing timelock reverts", async function () {
            const { proxyAdmin, zOPALProxy, zOPALFactory, deployer } =
                await loadFixture(deployTimelockUpgradeFixture);

            const newImpl = await zOPALFactory.deploy();

            // deployer is no longer the ProxyAdmin owner (timelock is)
            await expect(
                proxyAdmin.connect(deployer).upgrade(
                    await zOPALProxy.getAddress(),
                    await newImpl.getAddress()
                )
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
    });

    describe("initializeV2 constraints", function () {
        it("initializeV2 cannot be called again after upgrade", async function () {
            const { zToken, proxyAdmin, timelock, zOPALProxy, zOPALFactory, proposer, executor } =
                await loadFixture(deployTimelockUpgradeFixture);

            // Perform the upgrade
            const newImpl = await zOPALFactory.deploy();
            const initV2Data = zOPALFactory.interface.encodeFunctionData("initializeV2");
            const upgradeCalldata = proxyAdmin.interface.encodeFunctionData("upgradeAndCall", [
                await zOPALProxy.getAddress(),
                await newImpl.getAddress(),
                initV2Data
            ]);

            const salt = ethers.id("upgrade-reinit-test");
            const proxyAdminAddress = await proxyAdmin.getAddress();

            await timelock.connect(proposer).schedule(
                proxyAdminAddress, 0, upgradeCalldata, ethers.ZeroHash, salt, MIN_DELAY
            );
            await time.increase(MIN_DELAY);
            await timelock.connect(executor).execute(
                proxyAdminAddress, 0, upgradeCalldata, ethers.ZeroHash, salt
            );

            expect(await zToken.name()).to.equal("Zoth BlackOpal");

            // Try calling initializeV2 directly — should revert
            await expect(
                zToken.initializeV2()
            ).to.be.revertedWith("Initializable: contract is already initialized");
        });

        it("initialize() cannot be called again on the proxy", async function () {
            const { zToken, accessControl } = await loadFixture(deployTimelockUpgradeFixture);

            await expect(
                zToken.initialize(await accessControl.getAddress(), ethers.ZeroAddress)
            ).to.be.revertedWith("Initializable: contract is already initialized");
        });
    });

    describe("Cancel scheduled upgrade", function () {
        it("Executor (canceller) can cancel a scheduled upgrade", async function () {
            const { proxyAdmin, timelock, zOPALProxy, zOPALFactory, proposer, executor } =
                await loadFixture(deployTimelockUpgradeFixture);

            const newImpl = await zOPALFactory.deploy();
            const initV2Data = zOPALFactory.interface.encodeFunctionData("initializeV2");
            const upgradeCalldata = proxyAdmin.interface.encodeFunctionData("upgradeAndCall", [
                await zOPALProxy.getAddress(),
                await newImpl.getAddress(),
                initV2Data
            ]);

            const salt = ethers.id("upgrade-cancel-test");
            const proxyAdminAddress = await proxyAdmin.getAddress();

            // Schedule
            await timelock.connect(proposer).schedule(
                proxyAdminAddress, 0, upgradeCalldata, ethers.ZeroHash, salt, MIN_DELAY
            );

            const operationId = await timelock.hashOperation(
                proxyAdminAddress, 0, upgradeCalldata, ethers.ZeroHash, salt
            );

            expect(await timelock.isOperationPending(operationId)).to.be.true;

            // Executor (who has CANCELLER_ROLE) cancels
            await timelock.connect(executor).cancel(operationId);

            // Operation is no longer pending
            expect(await timelock.isOperationPending(operationId)).to.be.false;

            // Cannot execute after cancel, even after delay
            await time.increase(MIN_DELAY);
            await expect(
                timelock.connect(executor).execute(
                    proxyAdminAddress, 0, upgradeCalldata, ethers.ZeroHash, salt
                )
            ).to.be.revertedWith("TimelockController: operation is not ready");
        });

        it("Proposer (no CANCELLER_ROLE) cannot cancel", async function () {
            const { proxyAdmin, timelock, zOPALProxy, zOPALFactory, proposer } =
                await loadFixture(deployTimelockUpgradeFixture);

            const newImpl = await zOPALFactory.deploy();
            const initV2Data = zOPALFactory.interface.encodeFunctionData("initializeV2");
            const upgradeCalldata = proxyAdmin.interface.encodeFunctionData("upgradeAndCall", [
                await zOPALProxy.getAddress(),
                await newImpl.getAddress(),
                initV2Data
            ]);

            const salt = ethers.id("upgrade-cancel-unauth-test");
            const proxyAdminAddress = await proxyAdmin.getAddress();

            await timelock.connect(proposer).schedule(
                proxyAdminAddress, 0, upgradeCalldata, ethers.ZeroHash, salt, MIN_DELAY
            );

            const operationId = await timelock.hashOperation(
                proxyAdminAddress, 0, upgradeCalldata, ethers.ZeroHash, salt
            );

            // Proposer does NOT have CANCELLER_ROLE — should revert
            await expect(
                timelock.connect(proposer).cancel(operationId)
            ).to.be.reverted;
        });
    });
});
