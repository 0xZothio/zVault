import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Test suite covering:
 * #40 - Greenlist enabled → non-greenlisted wallet deposits → reverts
 * #41 - Greenlist disabled → any wallet can deposit → succeeds
 * #42 - setGreenlistEnable(false) on DepositVault → toggle works, greenlist bypassed
 * #43 - setGreenlistEnable(false) on RedemptionVault → toggle works, greenlist bypassed
 */
describe("Greenlist", function () {
    let depositVault: any;
    let redemptionVault: any;
    let zToken: any;
    let mockUSDC: any;

    let owner: SignerWithAddress;
    let greenlisted: SignerWithAddress;
    let nonGreenlisted: SignerWithAddress;

    async function deployGreenlistFixture() {
        const [deployer, greenlistedAccount, nonGreenlistedAccount, tokensReceiver, feeReceiver, requestRedeemer] =
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
            await functionsAccessControl.getAddress(), 8, 500, 86400
        );
        const stablecoinOracle = await PriceOracleFactory.deploy(
            await functionsAccessControl.getAddress(), 8, 500, 86400
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

        // Deploy DepositVault
        const DepositVaultFactory = await ethers.getContractFactory("DepositVault");
        const depositVaultImpl = await DepositVaultFactory.deploy();
        const depositVaultInitData = depositVaultImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            { zToken: await zToken.getAddress(), zTokenDataFeed: await priceOracle.getAddress() },
            { tokensReceiver: await tokensReceiver.getAddress(), feeReceiver: await feeReceiver.getAddress() },
            { instantFee: 100, instantDailyLimit: ethers.parseUnits("1000000", 18) },
            ethers.ZeroAddress, 100, ethers.parseUnits("1", 18), 0,
            ethers.parseUnits("10000000", 18)
        ]);
        const depositVaultProxy = await ERC1967ProxyFactory.deploy(await depositVaultImpl.getAddress(), depositVaultInitData);
        const depositVault = DepositVaultFactory.attach(await depositVaultProxy.getAddress()) as unknown as DepositVault;

        // Deploy RedemptionVault
        const RedemptionVaultFactory = await ethers.getContractFactory("RedemptionVault");
        const redemptionVaultImpl = await RedemptionVaultFactory.deploy();
        const redemptionVaultInitData = redemptionVaultImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            { zToken: await zToken.getAddress(), zTokenDataFeed: await priceOracle.getAddress() },
            { tokensReceiver: await tokensReceiver.getAddress(), feeReceiver: await feeReceiver.getAddress() },
            { instantFee: 100, instantDailyLimit: ethers.parseUnits("1000000", 18) },
            ethers.ZeroAddress, 100, ethers.parseUnits("1", 18),
            { minFiatRedeemAmount: ethers.parseUnits("100", 18), fiatAdditionalFee: 50, fiatFlatFee: ethers.parseUnits("10", 18) },
            await requestRedeemer.getAddress()
        ]);
        const redemptionVaultProxy = await ERC1967ProxyFactory.deploy(await redemptionVaultImpl.getAddress(), redemptionVaultInitData);
        const redemptionVault = RedemptionVaultFactory.attach(await redemptionVaultProxy.getAddress()) as unknown as RedemptionVault;

        // Grant roles
        const DEPOSIT_VAULT_ADMIN_ROLE = await accessControl.DEPOSIT_VAULT_ADMIN_ROLE();
        const REDEMPTION_VAULT_ADMIN_ROLE = await accessControl.REDEMPTION_VAULT_ADMIN_ROLE();
        const ZOPAL_MINT_OPERATOR_ROLE = await accessControl.ZOPAL_MINT_OPERATOR_ROLE();
        const ZOPAL_BURN_OPERATOR_ROLE = await accessControl.ZOPAL_BURN_OPERATOR_ROLE();
        const GREENLISTED_ROLE = await accessControl.GREENLISTED_ROLE();

        await accessControl.grantRole(DEPOSIT_VAULT_ADMIN_ROLE, await deployer.getAddress());
        await accessControl.grantRole(REDEMPTION_VAULT_ADMIN_ROLE, await deployer.getAddress());
        await accessControl.grantRole(ZOPAL_MINT_OPERATOR_ROLE, await depositVault.getAddress());
        await accessControl.grantRole(ZOPAL_BURN_OPERATOR_ROLE, await redemptionVault.getAddress());

        // Only grant greenlist to greenlistedAccount, NOT to nonGreenlistedAccount
        await accessControl.grantRole(GREENLISTED_ROLE, await greenlistedAccount.getAddress());

        // Add USDC payment token
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

        // Mint USDC to both users
        const usdcAmount = ethers.parseUnits("100000", 6);
        await mockUSDC.mint(await greenlistedAccount.getAddress(), usdcAmount);
        await mockUSDC.mint(await nonGreenlistedAccount.getAddress(), usdcAmount);

        await mockUSDC.connect(greenlistedAccount).approve(await depositVault.getAddress(), usdcAmount);
        await mockUSDC.connect(nonGreenlistedAccount).approve(await depositVault.getAddress(), usdcAmount);

        // Mint zOPAL for redemption tests (greenlistedAccount only, for fiat requests)
        await zToken.mint(await greenlistedAccount.getAddress(), ethers.parseUnits("10000", 18));
        await zToken.connect(greenlistedAccount).approve(await redemptionVault.getAddress(), ethers.MaxUint256);

        return {
            depositVault, redemptionVault, zToken, mockUSDC, accessControl,
            deployer, greenlistedAccount, nonGreenlistedAccount
        };
    }

    beforeEach(async function () {
        const fixture = await loadFixture(deployGreenlistFixture);
        depositVault = fixture.depositVault;
        redemptionVault = fixture.redemptionVault;
        zToken = fixture.zToken;
        mockUSDC = fixture.mockUSDC;
        owner = fixture.deployer;
        greenlisted = fixture.greenlistedAccount;
        nonGreenlisted = fixture.nonGreenlistedAccount;
    });

    describe("#40 — Greenlist enabled → non-greenlisted wallet deposits → reverts", function () {
        it("Should revert deposit for non-greenlisted wallet when greenlist is enabled", async function () {
            // Enable greenlist on deposit vault
            await depositVault.connect(owner).setGreenlistEnable(true);

            const depositAmount = ethers.parseUnits("1000", 6);
            await expect(
                depositVault.connect(nonGreenlisted).depositInstant(
                    await mockUSDC.getAddress(),
                    depositAmount,
                    0,
                    ethers.ZeroHash
                )
            ).to.be.revertedWith("WZAC: hasnt role");
        });

        it("Greenlisted wallet can still deposit when greenlist is enabled", async function () {
            await depositVault.connect(owner).setGreenlistEnable(true);

            const depositAmount = ethers.parseUnits("1000", 6);
            await expect(
                depositVault.connect(greenlisted).depositInstant(
                    await mockUSDC.getAddress(),
                    depositAmount,
                    0,
                    ethers.ZeroHash
                )
            ).to.emit(depositVault, "DepositInstant");
        });
    });

    describe("#41 — Greenlist disabled → any wallet can deposit → succeeds", function () {
        it("Non-greenlisted wallet can deposit when greenlist is disabled (default)", async function () {
            // greenlistEnabled is false by default — no greenlist enforcement
            expect(await depositVault.greenlistEnabled()).to.be.false;

            const depositAmount = ethers.parseUnits("1000", 6);
            await expect(
                depositVault.connect(nonGreenlisted).depositInstant(
                    await mockUSDC.getAddress(),
                    depositAmount,
                    0,
                    ethers.ZeroHash
                )
            ).to.emit(depositVault, "DepositInstant");
        });
    });

    describe("#42 — setGreenlistEnable(false) on DepositVault → toggle works, greenlist bypassed", function () {
        it("Enabling then disabling greenlist restores permissionless deposits", async function () {
            // Enable greenlist
            await depositVault.connect(owner).setGreenlistEnable(true);
            expect(await depositVault.greenlistEnabled()).to.be.true;

            // Non-greenlisted user blocked
            const depositAmount = ethers.parseUnits("1000", 6);
            await expect(
                depositVault.connect(nonGreenlisted).depositInstant(
                    await mockUSDC.getAddress(), depositAmount, 0, ethers.ZeroHash
                )
            ).to.be.revertedWith("WZAC: hasnt role");

            // Disable greenlist
            await expect(
                depositVault.connect(owner).setGreenlistEnable(false)
            ).to.emit(depositVault, "SetGreenlistEnable").withArgs(await owner.getAddress(), false);
            expect(await depositVault.greenlistEnabled()).to.be.false;

            // Non-greenlisted user can now deposit
            await expect(
                depositVault.connect(nonGreenlisted).depositInstant(
                    await mockUSDC.getAddress(), depositAmount, 0, ethers.ZeroHash
                )
            ).to.emit(depositVault, "DepositInstant");
        });

        it("Only vault admin can call setGreenlistEnable on DepositVault", async function () {
            await expect(
                depositVault.connect(nonGreenlisted).setGreenlistEnable(true)
            ).to.be.revertedWith("WZAC: hasnt role");
        });
    });

    describe("#43 — setGreenlistEnable(false) on RedemptionVault → toggle works, greenlist bypassed", function () {
        it("Enabling then disabling greenlist on RedemptionVault works correctly", async function () {
            // Enable greenlist on redemption vault
            await redemptionVault.connect(owner).setGreenlistEnable(true);
            expect(await redemptionVault.greenlistEnabled()).to.be.true;

            // Disable greenlist on redemption vault
            await expect(
                redemptionVault.connect(owner).setGreenlistEnable(false)
            ).to.emit(redemptionVault, "SetGreenlistEnable").withArgs(await owner.getAddress(), false);
            expect(await redemptionVault.greenlistEnabled()).to.be.false;
        });

        it("Cannot set same greenlist status twice — reverts", async function () {
            // Default is false; setting false again should revert
            await expect(
                depositVault.connect(owner).setGreenlistEnable(false)
            ).to.be.revertedWith("GL: same enable status");
        });
    });
});
