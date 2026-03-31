import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
/**
 * Test suite covering:
 * #1  - Sanctioned wallet attempts deposit → reverts
 * #2  - Sanctioned wallet attempts redemption → reverts
 * #3  - Sanctioned wallet transfers zOPAL (sender) → reverts
 * #4  - Transfer zOPAL to sanctioned wallet (recipient) → reverts
 * #5  - Sanctioned wallet tries mint via DepositVault → reverts
 * #6  - Blacklisted wallet attempts deposit → reverts
 * #7  - Blacklisted wallet attempts redemption → reverts
 * #8  - Blacklisted wallet attempts transfer → reverts
 */
describe("Sanctions and Blacklist", function () {
    let depositVault: any;
    let redemptionVault: any;
    let zToken: any;
    let mockUSDC: any;
    let mockSanctionsList: any;

    let user: SignerWithAddress;
    let sanctionedUser: SignerWithAddress;
    let blacklistedUser: SignerWithAddress;

    async function deploySystemWithSanctionsFixture() {
        const [deployer, userAccount, sanctionedAccount, blacklistedAccount, tokensReceiver, feeReceiver, requestRedeemer] =
            await ethers.getSigners();

        // Deploy MockSanctionsList
        const MockSanctionsListFactory = await ethers.getContractFactory("MockSanctionsList");
        const mockSanctionsList = await MockSanctionsListFactory.deploy();

        // Deploy ZothAccessControl (upgradeable)
        const AccessControlFactory = await ethers.getContractFactory("ZothAccessControl");
        const accessControlImpl = await AccessControlFactory.deploy();
        const initData = (accessControlImpl as any).interface.encodeFunctionData("initialize", []);

        const ERC1967ProxyFactory = await ethers.getContractFactory(
            "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"
        );
        const accessControlProxy = await ERC1967ProxyFactory.deploy(
            await accessControlImpl.getAddress(),
            initData
        );
        const accessControl = AccessControlFactory.attach(
            await accessControlProxy.getAddress()
        ) as any;

        // Deploy mock USDC
        const MockTokenFactory = await ethers.getContractFactory("MockERC20");
        const mockUSDC = await MockTokenFactory.deploy("USD Coin", "USDC", 6);

        // Deploy FunctionsAccessControl + PriceOracle
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

        // Deploy zOPAL with MockSanctionsList
        const zOPALFactory = await ethers.getContractFactory("zOPAL");
        const zTokenImpl = await zOPALFactory.deploy();
        const zTokenInitData = zTokenImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            await mockSanctionsList.getAddress() // sanctions enabled on zOPAL
        ]);
        const zTokenProxy = await ERC1967ProxyFactory.deploy(await zTokenImpl.getAddress(), zTokenInitData);
        const zToken = zOPALFactory.attach(await zTokenProxy.getAddress()) as unknown as ZOPAL;

        // Deploy DepositVault with MockSanctionsList
        const DepositVaultFactory = await ethers.getContractFactory("DepositVault");
        const depositVaultImpl = await DepositVaultFactory.deploy();
        const depositVaultInitData = depositVaultImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            { zToken: await zToken.getAddress(), zTokenDataFeed: await priceOracle.getAddress() },
            { tokensReceiver: await tokensReceiver.getAddress(), feeReceiver: await feeReceiver.getAddress() },
            { instantFee: 100, instantDailyLimit: ethers.parseUnits("1000000", 18) },
            await mockSanctionsList.getAddress(), // sanctions enabled on vault
            100,
            ethers.parseUnits("1", 18),
            0,
            ethers.parseUnits("10000000", 18)
        ]);
        const depositVaultProxy = await ERC1967ProxyFactory.deploy(await depositVaultImpl.getAddress(), depositVaultInitData);
        const depositVault = DepositVaultFactory.attach(await depositVaultProxy.getAddress()) as unknown as DepositVault;

        // Deploy RedemptionVault with MockSanctionsList
        const RedemptionVaultFactory = await ethers.getContractFactory("RedemptionVault");
        const redemptionVaultImpl = await RedemptionVaultFactory.deploy();
        const redemptionVaultInitData = redemptionVaultImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            { zToken: await zToken.getAddress(), zTokenDataFeed: await priceOracle.getAddress() },
            { tokensReceiver: await tokensReceiver.getAddress(), feeReceiver: await feeReceiver.getAddress() },
            { instantFee: 100, instantDailyLimit: ethers.parseUnits("1000000", 18) },
            await mockSanctionsList.getAddress(), // sanctions enabled on vault
            100,
            ethers.parseUnits("1", 18),
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
        const BLACKLISTED_ROLE = await accessControl.BLACKLISTED_ROLE();

        await accessControl.grantRole(DEPOSIT_VAULT_ADMIN_ROLE, await deployer.getAddress());
        await accessControl.grantRole(REDEMPTION_VAULT_ADMIN_ROLE, await deployer.getAddress());
        await accessControl.grantRole(ZOPAL_MINT_OPERATOR_ROLE, await depositVault.getAddress());
        await accessControl.grantRole(ZOPAL_BURN_OPERATOR_ROLE, await redemptionVault.getAddress());

        // Greenlist all test users (sanctions/blacklist is the focus, not greenlist)
        await accessControl.grantRole(GREENLISTED_ROLE, await userAccount.getAddress());
        await accessControl.grantRole(GREENLISTED_ROLE, await sanctionedAccount.getAddress());
        await accessControl.grantRole(GREENLISTED_ROLE, await blacklistedAccount.getAddress());

        // Add USDC as payment token
        await depositVault.addPaymentToken(
            await mockUSDC.getAddress(),
            await stablecoinOracle.getAddress(),
            0, // no token fee for clean testing
            ethers.parseUnits("1000000", 18),
            true
        );
        await redemptionVault.addPaymentToken(
            await mockUSDC.getAddress(),
            await stablecoinOracle.getAddress(),
            0,
            true
        );
        await redemptionVault.changeTokenAllowance(await mockUSDC.getAddress(), ethers.MaxUint256);

        // Mint USDC to users
        const usdcAmount = ethers.parseUnits("100000", 6);
        await mockUSDC.mint(await userAccount.getAddress(), usdcAmount);
        await mockUSDC.mint(await sanctionedAccount.getAddress(), usdcAmount);
        await mockUSDC.mint(await blacklistedAccount.getAddress(), usdcAmount);

        await mockUSDC.connect(userAccount).approve(await depositVault.getAddress(), usdcAmount);
        await mockUSDC.connect(sanctionedAccount).approve(await depositVault.getAddress(), usdcAmount);
        await mockUSDC.connect(blacklistedAccount).approve(await depositVault.getAddress(), usdcAmount);

        // Mint zOPAL BEFORE granting BLACKLISTED_ROLE (blacklist blocks _beforeTokenTransfer)
        const zTokenAmount = ethers.parseUnits("10000", 18);
        await zToken.mint(await userAccount.getAddress(), zTokenAmount);
        await zToken.mint(await sanctionedAccount.getAddress(), zTokenAmount);
        await zToken.mint(await blacklistedAccount.getAddress(), zTokenAmount);

        // Grant BLACKLISTED_ROLE only after minting is complete
        await accessControl.grantRole(BLACKLISTED_ROLE, await blacklistedAccount.getAddress());

        await zToken.connect(userAccount).approve(await redemptionVault.getAddress(), ethers.MaxUint256);
        await zToken.connect(sanctionedAccount).approve(await redemptionVault.getAddress(), ethers.MaxUint256);
        // approve() does not call _beforeTokenTransfer, so blacklisted accounts can still approve
        await zToken.connect(blacklistedAccount).approve(await redemptionVault.getAddress(), ethers.MaxUint256);

        // Fund redemption vault with USDC
        await mockUSDC.mint(await redemptionVault.getAddress(), ethers.parseUnits("100000", 6));

        return {
            mockSanctionsList, depositVault, redemptionVault, zToken, mockUSDC,
            accessControl, deployer, userAccount, sanctionedAccount, blacklistedAccount
        };
    }

    beforeEach(async function () {
        const fixture = await loadFixture(deploySystemWithSanctionsFixture);
        mockSanctionsList = fixture.mockSanctionsList;
        depositVault = fixture.depositVault;
        redemptionVault = fixture.redemptionVault;
        zToken = fixture.zToken;
        mockUSDC = fixture.mockUSDC;
        user = fixture.userAccount;
        sanctionedUser = fixture.sanctionedAccount;
        blacklistedUser = fixture.blacklistedAccount;
    });

    // ─────────────────────────────────────────────────────────
    // Sanctions Tests (#1–#5)
    // ─────────────────────────────────────────────────────────
    describe("Audit — Sanctions", function () {
        beforeEach(async function () {
            // Mark sanctionedUser as sanctioned
            await mockSanctionsList.setSanctioned(await sanctionedUser.getAddress(), true);
        });

        it("#1 Sanctioned wallet attempts deposit — reverts (WSL: sanctioned)", async function () {
            const depositAmount = ethers.parseUnits("1000", 6);
            await expect(
                depositVault.connect(sanctionedUser).depositInstant(
                    await mockUSDC.getAddress(),
                    depositAmount,
                    0,
                    ethers.ZeroHash
                )
            ).to.be.revertedWith("WSL: sanctioned");
        });

        it("#2 Sanctioned wallet attempts instant redemption — reverts (WSL: sanctioned)", async function () {
            const redeemAmount = ethers.parseUnits("500", 18);
            await expect(
                redemptionVault.connect(sanctionedUser).redeemInstant(
                    await mockUSDC.getAddress(),
                    redeemAmount,
                    0
                )
            ).to.be.revertedWith("WSL: sanctioned");
        });

        it("#3 Sanctioned wallet transfers zOPAL as sender — reverts (zOPAL: sanctioned)", async function () {
            const transferAmount = ethers.parseUnits("100", 18);
            await expect(
                zToken.connect(sanctionedUser).transfer(await user.getAddress(), transferAmount)
            ).to.be.revertedWith("zOPAL: sanctioned");
        });

        it("#4 Transfer zOPAL to sanctioned wallet as recipient — reverts (zOPAL: sanctioned)", async function () {
            const transferAmount = ethers.parseUnits("100", 18);
            await expect(
                zToken.connect(user).transfer(await sanctionedUser.getAddress(), transferAmount)
            ).to.be.revertedWith("zOPAL: sanctioned");
        });

        it("#5 Sanctioned wallet tries to trigger mint via DepositVault — reverts (WSL: sanctioned)", async function () {
            // depositInstant triggers zOPAL minting; sanctions block before reaching mint
            const depositAmount = ethers.parseUnits("1000", 6);
            await expect(
                depositVault.connect(sanctionedUser).depositInstant(
                    await mockUSDC.getAddress(),
                    depositAmount,
                    0,
                    ethers.ZeroHash
                )
            ).to.be.revertedWith("WSL: sanctioned");
        });

        it("Clean wallet (not sanctioned) can deposit normally", async function () {
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

    // ─────────────────────────────────────────────────────────
    // Blacklist Tests (#6–#8)
    // ─────────────────────────────────────────────────────────
    describe("Audit — Blacklist", function () {
        it("#6 Blacklisted wallet attempts deposit — reverts (WZAC: has role)", async function () {
            const depositAmount = ethers.parseUnits("1000", 6);
            await expect(
                depositVault.connect(blacklistedUser).depositInstant(
                    await mockUSDC.getAddress(),
                    depositAmount,
                    0,
                    ethers.ZeroHash
                )
            ).to.be.revertedWith("WZAC: has role");
        });

        it("#7 Blacklisted wallet attempts instant redemption — reverts (WZAC: has role)", async function () {
            const redeemAmount = ethers.parseUnits("500", 18);
            await expect(
                redemptionVault.connect(blacklistedUser).redeemInstant(
                    await mockUSDC.getAddress(),
                    redeemAmount,
                    0
                )
            ).to.be.revertedWith("WZAC: has role");
        });

        it("#8 Blacklisted wallet attempts zOPAL transfer — reverts (WZAC: has role)", async function () {
            const transferAmount = ethers.parseUnits("100", 18);
            await expect(
                zToken.connect(blacklistedUser).transfer(await user.getAddress(), transferAmount)
            ).to.be.revertedWith("WZAC: has role");
        });

        it("Blacklisted wallet cannot receive zOPAL transfer — reverts (WZAC: has role)", async function () {
            const transferAmount = ethers.parseUnits("100", 18);
            await expect(
                zToken.connect(user).transfer(await blacklistedUser.getAddress(), transferAmount)
            ).to.be.revertedWith("WZAC: has role");
        });

        it("Clean wallet (not blacklisted) can deposit normally", async function () {
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
});
