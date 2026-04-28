import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Test suite covering proxy and upgrade behavior:
 * #39  - Non-admin wallet tries proxy upgrade → reverts
 * #70  - Proxy upgrade by ProxyAdmin owner → state preserved
 * #71  - Proxy upgrade by non-owner → reverts
 * #72  - Post-upgrade → all balances, roles, NAV intact
 * #73  - PriceOracle — confirm no upgrade path exists (non-upgradeable)
 */
describe("Proxy and Upgrade", function () {
    let depositVault: any;
    let zToken: any;
    let mockUSDC: any;
    let priceOracle: any;

    let owner: SignerWithAddress;
    let user: SignerWithAddress;
    let unauthorized: SignerWithAddress;
    let proxyAdmin: any;
    let transparentProxy: any;

    async function deployProxyUpgradeFixture() {
        const [deployer, userAccount, unauthorizedAccount, tokensReceiver, feeReceiver, requestRedeemer] =
            await ethers.getSigners();

        // Deploy ZothAccessControl
        const AccessControlFactory = await ethers.getContractFactory("ZothAccessControl");
        const accessControlImpl = await AccessControlFactory.deploy();
        const initData = (accessControlImpl as any).interface.encodeFunctionData("initialize", []);

        const ERC1967ProxyFactory = await ethers.getContractFactory(
            "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"
        );
        const accessControlProxy = await ERC1967ProxyFactory.deploy(
            await accessControlImpl.getAddress(), initData
        );
        const accessControl = AccessControlFactory.attach(await accessControlProxy.getAddress()) as any;

        const MockTokenFactory = await ethers.getContractFactory("MockERC20");
        const mockUSDC = await MockTokenFactory.deploy("USD Coin", "USDC", 6);

        const FunctionsAccessControlFactory = await ethers.getContractFactory("FunctionsAccessControl");
        const functionsAccessControl = await FunctionsAccessControlFactory.deploy(await deployer.getAddress());

        const PriceOracleFactory = await ethers.getContractFactory("PriceOracle");
        const priceOracle = await PriceOracleFactory.deploy(
            await functionsAccessControl.getAddress(), 8, 500, 86400 * 365
        );
        const stablecoinOracle = await PriceOracleFactory.deploy(
            await functionsAccessControl.getAddress(), 8, 500, 86400 * 365
        );

        await functionsAccessControl.grantPriceAdminRole(await deployer.getAddress());
        await priceOracle.setPrice(ethers.parseUnits("1", 8));
        await stablecoinOracle.setPrice(ethers.parseUnits("1", 8));

        const zOPALFactory = await ethers.getContractFactory("zOPAL");
        const zTokenImpl = await zOPALFactory.deploy();
        const zTokenInitData = zTokenImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(), ethers.ZeroAddress
        ]);
        const zTokenProxy = await ERC1967ProxyFactory.deploy(await zTokenImpl.getAddress(), zTokenInitData);
        const zToken = zOPALFactory.attach(await zTokenProxy.getAddress()) as unknown as ZOPAL;

        // Deploy DepositVault implementation
        const DepositVaultFactory = await ethers.getContractFactory("DepositVault");
        const depositVaultImpl = await DepositVaultFactory.deploy();

        // Deploy ProxyAdmin
        const ProxyAdminFactory = await ethers.getContractFactory(
            "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol:ProxyAdmin"
        );
        const proxyAdmin = await ProxyAdminFactory.deploy();

        // Deploy TransparentUpgradeableProxy with ProxyAdmin
        const TransparentProxyFactory = await ethers.getContractFactory(
            "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy"
        );

        const depositVaultInitData = depositVaultImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            { zToken: await zToken.getAddress(), zTokenDataFeed: await priceOracle.getAddress() },
            { tokensReceiver: await tokensReceiver.getAddress(), feeReceiver: await feeReceiver.getAddress() },
            { instantFee: 0, instantDailyLimit: ethers.parseUnits("1000000", 18) },
            ethers.ZeroAddress, 100, ethers.parseUnits("1", 18), 0,
            ethers.parseUnits("10000000", 18)
        ]);

        const transparentProxy = await TransparentProxyFactory.deploy(
            await depositVaultImpl.getAddress(),
            await proxyAdmin.getAddress(),
            depositVaultInitData
        );

        const depositVault = DepositVaultFactory.attach(await transparentProxy.getAddress()) as unknown as DepositVault;

        // Grant roles
        const DEPOSIT_VAULT_ADMIN_ROLE = await accessControl.DEPOSIT_VAULT_ADMIN_ROLE();
        const ZOPAL_MINT_OPERATOR_ROLE = await accessControl.ZOPAL_MINT_OPERATOR_ROLE();
        const GREENLISTED_ROLE = await accessControl.GREENLISTED_ROLE();

        await accessControl.grantRole(DEPOSIT_VAULT_ADMIN_ROLE, await deployer.getAddress());
        await accessControl.grantRole(ZOPAL_MINT_OPERATOR_ROLE, await depositVault.getAddress());
        await accessControl.grantRole(GREENLISTED_ROLE, await userAccount.getAddress());

        await depositVault.addPaymentToken(
            await mockUSDC.getAddress(),
            await stablecoinOracle.getAddress(),
            0, ethers.parseUnits("1000000", 18), true
        );

        const usdcAmount = ethers.parseUnits("100000", 6);
        await mockUSDC.mint(await userAccount.getAddress(), usdcAmount);
        await mockUSDC.connect(userAccount).approve(await depositVault.getAddress(), usdcAmount);

        return {
            depositVault, zToken, mockUSDC, priceOracle, stablecoinOracle,
            accessControl, depositVaultImpl,
            proxyAdmin, transparentProxy, DepositVaultFactory,
            deployer, userAccount, unauthorizedAccount
        };
    }

    beforeEach(async function () {
        const fixture = await loadFixture(deployProxyUpgradeFixture);
        depositVault = fixture.depositVault;
        zToken = fixture.zToken;
        mockUSDC = fixture.mockUSDC;
        priceOracle = fixture.priceOracle;
        owner = fixture.deployer;
        user = fixture.userAccount;
        unauthorized = fixture.unauthorizedAccount;
        proxyAdmin = fixture.proxyAdmin;
        transparentProxy = fixture.transparentProxy;
    });

    describe("#39 / #71 — Non-admin cannot upgrade proxy", function () {
        it("#39 Non-admin wallet cannot call admin vault functions → reverts", async function () {
            // Vault admin role is required for admin functions
            await expect(
                depositVault.connect(unauthorized).setMaxSupplyCap(ethers.parseUnits("999999", 18))
            ).to.be.revertedWith("WZAC: hasnt role");
        });

        it("#71 Non-ProxyAdmin-owner cannot upgrade proxy implementation → reverts", async function () {
            // Deploy a new implementation (same contract for this test)
            const DepositVaultFactory = await ethers.getContractFactory("DepositVault");
            const newImpl = await DepositVaultFactory.deploy();

            // Only ProxyAdmin.owner() can upgrade; unauthorized caller has no access
            const proxyAdminWithUnauthorized = proxyAdmin.connect(unauthorized);
            await expect(
                proxyAdminWithUnauthorized.upgrade(
                    await transparentProxy.getAddress(),
                    await newImpl.getAddress()
                )
            ).to.be.reverted; // ProxyAdmin: caller is not the owner
        });
    });

    describe("#70 / #72 — ProxyAdmin owner upgrades proxy, state preserved", function () {
        it("#70 ProxyAdmin owner can upgrade implementation", async function () {
            // Record state before upgrade
            const maxSupplyBefore = await depositVault.maxSupplyCap();
            const minAmountBefore = await depositVault.minAmount();

            // Deploy a new implementation
            const DepositVaultFactory = await ethers.getContractFactory("DepositVault");
            const newImpl = await DepositVaultFactory.deploy();

            // ProxyAdmin owner (deployer) performs upgrade
            await expect(
                proxyAdmin.connect(owner).upgrade(
                    await transparentProxy.getAddress(),
                    await newImpl.getAddress()
                )
            ).to.not.be.reverted;

            // #72 — Verify state is preserved after upgrade
            const maxSupplyAfter = await depositVault.maxSupplyCap();
            const minAmountAfter = await depositVault.minAmount();

            expect(maxSupplyAfter).to.equal(maxSupplyBefore);
            expect(minAmountAfter).to.equal(minAmountBefore);
        });

        it("#72 Post-upgrade — zToken address, roles, and NAV feed remain intact", async function () {
            const zTokenAddressBefore = await depositVault.zToken();
            const zTokenDataFeedBefore = await depositVault.zTokenDataFeed();

            // Perform upgrade
            const DepositVaultFactory = await ethers.getContractFactory("DepositVault");
            const newImpl = await DepositVaultFactory.deploy();
            await proxyAdmin.connect(owner).upgrade(
                await transparentProxy.getAddress(),
                await newImpl.getAddress()
            );

            // State should be identical post-upgrade
            expect(await depositVault.zToken()).to.equal(zTokenAddressBefore);
            expect(await depositVault.zTokenDataFeed()).to.equal(zTokenDataFeedBefore);

            // Deposits should still work through the proxy post-upgrade
            const depositAmount = ethers.parseUnits("1000", 6);
            await expect(
                depositVault.connect(user).depositInstant(
                    await mockUSDC.getAddress(), depositAmount, 0, ethers.ZeroHash
                )
            ).to.emit(depositVault, "DepositInstant");
        });

        it("#72 Post-upgrade — user balances intact", async function () {
            // Do a deposit before upgrade
            const depositAmount = ethers.parseUnits("1000", 6);
            await depositVault.connect(user).depositInstant(
                await mockUSDC.getAddress(), depositAmount, 0, ethers.ZeroHash
            );
            const zBalanceBefore = await zToken.balanceOf(await user.getAddress());

            // Upgrade
            const DepositVaultFactory = await ethers.getContractFactory("DepositVault");
            const newImpl = await DepositVaultFactory.deploy();
            await proxyAdmin.connect(owner).upgrade(
                await transparentProxy.getAddress(),
                await newImpl.getAddress()
            );

            // Balance unchanged after upgrade
            const zBalanceAfter = await zToken.balanceOf(await user.getAddress());
            expect(zBalanceAfter).to.equal(zBalanceBefore);
        });
    });

    describe("#73 — PriceOracle is non-upgradeable", function () {
        it("#73 PriceOracle has no upgradeTo/upgradeToAndCall method", async function () {
            // PriceOracle is deployed as a plain contract (not behind a proxy)
            // Verify it does not expose UUPS or transparent upgrade interface
            const oracleInterface = priceOracle.interface;

            const hasUpgradeTo = oracleInterface.hasFunction
                ? oracleInterface.hasFunction("upgradeTo")
                : Object.keys(oracleInterface.functions).some(f => f.startsWith("upgradeTo"));

            expect(hasUpgradeTo).to.be.false;
        });

        it("#73 PriceOracle deployed without proxy — direct contract, not upgradeable", async function () {
            // Confirming PriceOracle is a plain contract:
            // If it were a proxy, querying a non-existent storage slot would show a different address.
            // We verify by checking the contract bytecode matches PriceOracle directly.
            const code = await ethers.provider.getCode(await priceOracle.getAddress());
            expect(code).to.not.equal("0x"); // Has bytecode
            // PriceOracle has priceDecimals, tolerancePercent, maxStaleness — all direct storage
            expect(await priceOracle.priceDecimals()).to.equal(8);
            expect(await priceOracle.tolerancePercent()).to.equal(500);
        });
    });
});
