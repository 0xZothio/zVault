import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Test suite covering vault-level oracle integration:
 * #12 - Oracle stale beyond maxStaleness → deposit reverts with StalePrice
 * #13 - Oracle stale beyond maxStaleness → redemption reverts with StalePrice
 * #14 - Oracle updated within staleness window → deposit succeeds
 * #29 - Oracle returns 0 → vault rejects (rate zero check)
 * #61 - NAV update → token price reflects new value on next tx
 * #65 - Oracle not submitted within staleness window → all ops blocked
 */
describe("Vault Oracle Integration", function () {
    let depositVault: any;
    let redemptionVault: any;
    let zToken: any;
    let mockUSDC: any;
    let priceOracle: any;
    let stablecoinOracle: any;

    let owner: SignerWithAddress;
    let user: SignerWithAddress;

    const MAX_STALENESS = 86400; // 24 hours

    async function deployVaultOracleFixture() {
        const [deployer, userAccount, tokensReceiver, feeReceiver, requestRedeemer] =
            await ethers.getSigners();

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
        // zOPAL price oracle: 24h maxStaleness, 100% tolerance so NAV-jump tests work
        const priceOracle = await PriceOracleFactory.deploy(
            await functionsAccessControl.getAddress(), 8, 10000, MAX_STALENESS
        );
        // Stablecoin oracle — long staleness so it won't be the bottleneck
        const stablecoinOracle = await PriceOracleFactory.deploy(
            await functionsAccessControl.getAddress(), 8, 500, MAX_STALENESS * 10
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

        const DepositVaultFactory = await ethers.getContractFactory("DepositVault");
        const depositVaultImpl = await DepositVaultFactory.deploy();
        const depositVaultInitData = depositVaultImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            { zToken: await zToken.getAddress(), zTokenDataFeed: await priceOracle.getAddress() },
            { tokensReceiver: await tokensReceiver.getAddress(), feeReceiver: await feeReceiver.getAddress() },
            { instantFee: 0, instantDailyLimit: ethers.parseUnits("1000000", 18) },
            ethers.ZeroAddress, 10000, ethers.parseUnits("1", 18), 0,
            ethers.parseUnits("10000000", 18)
        ]);
        const depositVaultProxy = await ERC1967ProxyFactory.deploy(await depositVaultImpl.getAddress(), depositVaultInitData);
        const depositVault = DepositVaultFactory.attach(await depositVaultProxy.getAddress()) as unknown as DepositVault;

        const RedemptionVaultFactory = await ethers.getContractFactory("RedemptionVault");
        const redemptionVaultImpl = await RedemptionVaultFactory.deploy();
        const redemptionVaultInitData = redemptionVaultImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            { zToken: await zToken.getAddress(), zTokenDataFeed: await priceOracle.getAddress() },
            { tokensReceiver: await tokensReceiver.getAddress(), feeReceiver: await feeReceiver.getAddress() },
            { instantFee: 0, instantDailyLimit: ethers.parseUnits("1000000", 18) },
            ethers.ZeroAddress, 10000, ethers.parseUnits("1", 18),
            { minFiatRedeemAmount: ethers.parseUnits("100", 18), fiatAdditionalFee: 50, fiatFlatFee: ethers.parseUnits("10", 18) },
            await requestRedeemer.getAddress()
        ]);
        const redemptionVaultProxy = await ERC1967ProxyFactory.deploy(await redemptionVaultImpl.getAddress(), redemptionVaultInitData);
        const redemptionVault = RedemptionVaultFactory.attach(await redemptionVaultProxy.getAddress()) as unknown as RedemptionVault;

        const DEPOSIT_VAULT_ADMIN_ROLE = await accessControl.DEPOSIT_VAULT_ADMIN_ROLE();
        const REDEMPTION_VAULT_ADMIN_ROLE = await accessControl.REDEMPTION_VAULT_ADMIN_ROLE();
        const ZOPAL_MINT_OPERATOR_ROLE = await accessControl.ZOPAL_MINT_OPERATOR_ROLE();
        const ZOPAL_BURN_OPERATOR_ROLE = await accessControl.ZOPAL_BURN_OPERATOR_ROLE();
        const GREENLISTED_ROLE = await accessControl.GREENLISTED_ROLE();

        await accessControl.grantRole(DEPOSIT_VAULT_ADMIN_ROLE, await deployer.getAddress());
        await accessControl.grantRole(REDEMPTION_VAULT_ADMIN_ROLE, await deployer.getAddress());
        await accessControl.grantRole(ZOPAL_MINT_OPERATOR_ROLE, await depositVault.getAddress());
        await accessControl.grantRole(ZOPAL_BURN_OPERATOR_ROLE, await redemptionVault.getAddress());
        await accessControl.grantRole(GREENLISTED_ROLE, await userAccount.getAddress());

        await depositVault.addPaymentToken(
            await mockUSDC.getAddress(),
            await stablecoinOracle.getAddress(),
            0, ethers.parseUnits("1000000", 18), true
        );
        await redemptionVault.addPaymentToken(
            await mockUSDC.getAddress(),
            await stablecoinOracle.getAddress(),
            0, true
        );
        await redemptionVault.changeTokenAllowance(await mockUSDC.getAddress(), ethers.MaxUint256);

        const usdcAmount = ethers.parseUnits("100000", 6);
        await mockUSDC.mint(await userAccount.getAddress(), usdcAmount);
        await mockUSDC.connect(userAccount).approve(await depositVault.getAddress(), usdcAmount);

        // Mint zOPAL to user for redemption tests
        await zToken.mint(await userAccount.getAddress(), ethers.parseUnits("10000", 18));
        await zToken.connect(userAccount).approve(await redemptionVault.getAddress(), ethers.MaxUint256);

        // Fund redemption vault with USDC
        await mockUSDC.mint(await redemptionVault.getAddress(), ethers.parseUnits("100000", 6));

        return {
            depositVault, redemptionVault, zToken, mockUSDC, priceOracle, stablecoinOracle,
            accessControl, functionsAccessControl, deployer, userAccount
        };
    }

    beforeEach(async function () {
        const fixture = await loadFixture(deployVaultOracleFixture);
        depositVault = fixture.depositVault;
        redemptionVault = fixture.redemptionVault;
        zToken = fixture.zToken;
        mockUSDC = fixture.mockUSDC;
        priceOracle = fixture.priceOracle;
        stablecoinOracle = fixture.stablecoinOracle;
        owner = fixture.deployer;
        user = fixture.userAccount;
    });

    describe("Audit — Stale Oracle (#12, #13, #14)", function () {
        it("#12 Oracle stale beyond maxStaleness → deposit reverts with StalePrice", async function () {
            // Advance time beyond maxStaleness (24h)
            await time.increase(MAX_STALENESS + 1);

            const depositAmount = ethers.parseUnits("1000", 6);
            await expect(
                depositVault.connect(user).depositInstant(
                    await mockUSDC.getAddress(),
                    depositAmount,
                    0,
                    ethers.ZeroHash
                )
            ).to.be.revertedWithCustomError(priceOracle, "StalePrice");
        });

        it("#13 Oracle stale beyond maxStaleness → instant redemption reverts with StalePrice", async function () {
            await time.increase(MAX_STALENESS + 1);

            const redeemAmount = ethers.parseUnits("500", 18);
            await expect(
                redemptionVault.connect(user).redeemInstant(
                    await mockUSDC.getAddress(),
                    redeemAmount,
                    0
                )
            ).to.be.revertedWithCustomError(priceOracle, "StalePrice");
        });

        it("#14 Oracle updated within staleness window → deposit succeeds", async function () {
            // Advance time but stay within staleness window
            await time.increase(MAX_STALENESS / 2);

            // Oracle is still fresh — deposit should succeed
            const depositAmount = ethers.parseUnits("1000", 6);
            await expect(
                depositVault.connect(user).depositInstant(
                    await mockUSDC.getAddress(),
                    depositAmount,
                    0,
                    ethers.ZeroHash
                )
            ).to.emit(depositVault, "DepositInstant");
        });

        it("#14 (cont.) Refreshing oracle after staleness allows deposit to proceed", async function () {
            // Go past staleness
            await time.increase(MAX_STALENESS + 1);

            // Update oracle (admin refreshes price)
            const functionsAccessControl = await ethers.getContractAt(
                "FunctionsAccessControl",
                await priceOracle.accessControl()
            );
            // Deployer is price admin — refresh price
            await priceOracle.setPrice(ethers.parseUnits("1", 8));

            // Now deposit should succeed
            const depositAmount = ethers.parseUnits("1000", 6);
            await expect(
                depositVault.connect(user).depositInstant(
                    await mockUSDC.getAddress(),
                    depositAmount,
                    0,
                    ethers.ZeroHash
                )
            ).to.emit(depositVault, "DepositInstant");
        });
    });

    describe("Audit — Zero Oracle (#29)", function () {
        it("#29 Oracle returns 0 → vault rejects with rate zero error", async function () {
            // Deploy a MockDataFeed that returns 0
            const MockDataFeedFactory = await ethers.getContractFactory("MockDataFeed");
            const zeroOracle = await MockDataFeedFactory.deploy(0n);

            // Deploy a fresh deposit vault pointing to the zero-returning oracle
            const AccessControlFactory = await ethers.getContractFactory("ZothAccessControl");
            const accessControlImpl = await AccessControlFactory.deploy();
            const initData = (accessControlImpl as any).interface.encodeFunctionData("initialize", []);
            const ERC1967ProxyFactory = await ethers.getContractFactory(
                "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"
            );
            const acProxy = await ERC1967ProxyFactory.deploy(await accessControlImpl.getAddress(), initData);
            const ac = AccessControlFactory.attach(await acProxy.getAddress()) as any;

            const DepositVaultFactory = await ethers.getContractFactory("DepositVault");
            const dvImpl = await DepositVaultFactory.deploy();
            const dvInitData = dvImpl.interface.encodeFunctionData("initialize", [
                await ac.getAddress(),
                { zToken: await zToken.getAddress(), zTokenDataFeed: await zeroOracle.getAddress() },
                { tokensReceiver: await owner.getAddress(), feeReceiver: await owner.getAddress() },
                { instantFee: 0, instantDailyLimit: ethers.parseUnits("1000000", 18) },
                ethers.ZeroAddress, 100, ethers.parseUnits("1", 18), 0,
                ethers.parseUnits("10000000", 18)
            ]);
            const dvProxy = await ERC1967ProxyFactory.deploy(await dvImpl.getAddress(), dvInitData);
            const zeroVault = DepositVaultFactory.attach(await dvProxy.getAddress()) as unknown as DepositVault;

            // Grant roles on the fresh AC
            await ac.grantRole(await ac.DEPOSIT_VAULT_ADMIN_ROLE(), await owner.getAddress());
            await ac.grantRole(await ac.ZOPAL_MINT_OPERATOR_ROLE(), await zeroVault.getAddress());
            await ac.grantRole(await ac.GREENLISTED_ROLE(), await user.getAddress());

            // Add USDC with a valid stablecoin oracle
            const PriceOracleFactory = await ethers.getContractFactory("PriceOracle");
            const FunctionsACFactory = await ethers.getContractFactory("FunctionsAccessControl");
            const fac = await FunctionsACFactory.deploy(await owner.getAddress());
            await fac.grantPriceAdminRole(await owner.getAddress());
            const stabOracle = await PriceOracleFactory.deploy(await fac.getAddress(), 8, 500, 86400 * 365);
            await stabOracle.setPrice(ethers.parseUnits("1", 8));
            await zeroVault.addPaymentToken(
                await mockUSDC.getAddress(),
                await stabOracle.getAddress(),
                0, ethers.parseUnits("1000000", 18), true
            );

            const depositAmount = ethers.parseUnits("1000", 6);
            await mockUSDC.mint(await user.getAddress(), depositAmount);
            await mockUSDC.connect(user).approve(await zeroVault.getAddress(), depositAmount);

            // Oracle returns 0 for zOPAL rate → vault reverts with "DV: rate zero"
            await expect(
                zeroVault.connect(user).depositInstant(
                    await mockUSDC.getAddress(),
                    depositAmount,
                    0,
                    ethers.ZeroHash
                )
            ).to.be.revertedWith("DV: rate zero");
        });
    });

    describe("Audit — NAV Reflects on Next Tx (#61)", function () {
        it("#61 NAV update → subsequent deposit uses new NAV, not old one", async function () {
            const depositAmount = ethers.parseUnits("1000", 6);

            // Snapshot balance before first deposit to isolate incremental mints
            const zBalanceBefore = await zToken.balanceOf(await user.getAddress());

            // First deposit at NAV = $1 → expect ~1000 zOPAL minted
            await depositVault.connect(user).depositInstant(
                await mockUSDC.getAddress(), depositAmount, 0, ethers.ZeroHash
            );
            const zBalanceAfterNav1 = await zToken.balanceOf(await user.getAddress());
            const zMintedAtNav1 = zBalanceAfterNav1 - zBalanceBefore; // ~1000 zOPAL

            // NAV doubles to $2 (100% tolerance allows this jump)
            await priceOracle.setPrice(ethers.parseUnits("2", 8));

            // Second deposit at NAV = $2 → expect ~500 zOPAL for the same USDC input
            await mockUSDC.mint(await user.getAddress(), depositAmount);
            await mockUSDC.connect(user).approve(await depositVault.getAddress(), depositAmount);
            await depositVault.connect(user).depositInstant(
                await mockUSDC.getAddress(), depositAmount, 0, ethers.ZeroHash
            );
            const zBalanceAfterNav2 = await zToken.balanceOf(await user.getAddress());
            const zMintedAtNav2 = zBalanceAfterNav2 - zBalanceAfterNav1; // ~500 zOPAL

            // At $2 NAV, same USD input yields half the zOPAL → confirms NAV is used on each tx
            expect(zMintedAtNav1).to.be.closeTo(ethers.parseUnits("1000", 18), ethers.parseUnits("5", 18));
            expect(zMintedAtNav2).to.be.closeTo(ethers.parseUnits("500", 18), ethers.parseUnits("5", 18));
            expect(zMintedAtNav1).to.be.closeTo(zMintedAtNav2 * 2n, ethers.parseUnits("5", 18));
        });
    });

    describe("Audit — Oracle Staleness Blocks All Vault Ops (#65)", function () {
        it("#65 Oracle not updated within staleness window → deposit and redemption both blocked", async function () {
            // Advance past staleness
            await time.increase(MAX_STALENESS + 1);

            // Deposit blocked
            await expect(
                depositVault.connect(user).depositInstant(
                    await mockUSDC.getAddress(),
                    ethers.parseUnits("1000", 6),
                    0,
                    ethers.ZeroHash
                )
            ).to.be.revertedWithCustomError(priceOracle, "StalePrice");

            // Instant redemption blocked
            await expect(
                redemptionVault.connect(user).redeemInstant(
                    await mockUSDC.getAddress(),
                    ethers.parseUnits("500", 18),
                    0
                )
            ).to.be.revertedWithCustomError(priceOracle, "StalePrice");

            // Deposit request blocked
            await expect(
                depositVault.connect(user).depositRequest(
                    await mockUSDC.getAddress(),
                    ethers.parseUnits("1000", 6),
                    ethers.ZeroHash
                )
            ).to.be.revertedWithCustomError(priceOracle, "StalePrice");

            // Redeem request blocked
            await expect(
                redemptionVault.connect(user).redeemRequest(
                    await mockUSDC.getAddress(),
                    ethers.parseUnits("500", 18)
                )
            ).to.be.revertedWithCustomError(priceOracle, "StalePrice");
        });
    });
});
