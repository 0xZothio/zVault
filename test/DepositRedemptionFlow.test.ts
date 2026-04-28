import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Test suite covering deposit/redemption flow edge cases and fee math:
 * #27 - approveRequest with arbitrary rate by VAULT_ADMIN → succeeds (no oracle check)
 * #28 - approveRequest by non-VAULT_ADMIN wallet → reverts
 * #45 - minReceiveAmount slippage protection → reverts when NAV moves against user
 * #47 - Deposit request → admin approves → zOPAL minted
 * #51 - Deposit with non-whitelisted ERC-20 token → reverts
 * #54 - Instant fee math: USDC = (zOPAL - 0.5%) × NAV
 * #55 - Standard fee math: USDC = (zOPAL - 0.1%) × NAV
 * #59 - Mint increases totalSupply correctly
 * #60 - Burn decreases totalSupply correctly
 * #62 - Multiple deposits at different NAVs → correct proportional shares
 * #75 - Deposit with USDC (whitelisted) → succeeds
 * #76 - Add new payment token → deposits succeed
 * #77 - Remove payment token → deposits revert
 */
describe("Deposit and Redemption Flow", function () {
    let depositVault: any;
    let redemptionVault: any;
    let zToken: any;
    let mockUSDC: any;
    let mockDAI: any;
    let priceOracle: any;
    let stablecoinOracle: any;

    let owner: SignerWithAddress;
    let user: SignerWithAddress;
    let user2: SignerWithAddress;
    let unauthorized: SignerWithAddress;
    let tokensReceiver: SignerWithAddress;
    let requestRedeemer: SignerWithAddress;

    async function deployFlowFixture() {
        const [deployer, userAccount, user2Account, unauthorizedAccount, tokensReceiverAccount, feeReceiverAccount, requestRedeemerAccount] =
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
        const mockDAI = await MockTokenFactory.deploy("Dai Stablecoin", "DAI", 18);

        const FunctionsAccessControlFactory = await ethers.getContractFactory("FunctionsAccessControl");
        const functionsAccessControl = await FunctionsAccessControlFactory.deploy(await deployer.getAddress());

        const PriceOracleFactory = await ethers.getContractFactory("PriceOracle");
        const priceOracle = await PriceOracleFactory.deploy(
            await functionsAccessControl.getAddress(), 8, 10000, 86400 * 365 // 100% tolerance for NAV test
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

        // instantFee = 50 (0.5%) for redemption vault — fee math test
        const DepositVaultFactory = await ethers.getContractFactory("DepositVault");
        const depositVaultImpl = await DepositVaultFactory.deploy();
        const depositVaultInitData = depositVaultImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            { zToken: await zToken.getAddress(), zTokenDataFeed: await priceOracle.getAddress() },
            { tokensReceiver: await tokensReceiverAccount.getAddress(), feeReceiver: await feeReceiverAccount.getAddress() },
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
            { tokensReceiver: await tokensReceiverAccount.getAddress(), feeReceiver: await feeReceiverAccount.getAddress() },
            { instantFee: 50, instantDailyLimit: ethers.parseUnits("1000000", 18) }, // 0.5% instant fee
            ethers.ZeroAddress, 10000, ethers.parseUnits("1", 18),
            {
                minFiatRedeemAmount: ethers.parseUnits("1", 18),
                fiatAdditionalFee: 0,
                fiatFlatFee: 0
            },
            await requestRedeemerAccount.getAddress()
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
        // Give deployer direct mint/burn for setup
        await accessControl.grantRole(ZOPAL_MINT_OPERATOR_ROLE, await deployer.getAddress());
        await accessControl.grantRole(GREENLISTED_ROLE, await userAccount.getAddress());
        await accessControl.grantRole(GREENLISTED_ROLE, await user2Account.getAddress());

        await depositVault.addPaymentToken(
            await mockUSDC.getAddress(),
            await stablecoinOracle.getAddress(),
            0, ethers.parseUnits("1000000", 18), true
        );
        await redemptionVault.addPaymentToken(
            await mockUSDC.getAddress(),
            await stablecoinOracle.getAddress(),
            10, // 0.1% standard token fee for test #55
            true
        );
        await redemptionVault.changeTokenAllowance(await mockUSDC.getAddress(), ethers.MaxUint256);

        const usdcAmount = ethers.parseUnits("100000", 6);
        await mockUSDC.mint(await userAccount.getAddress(), usdcAmount);
        await mockUSDC.mint(await user2Account.getAddress(), usdcAmount);
        await mockUSDC.connect(userAccount).approve(await depositVault.getAddress(), usdcAmount);
        await mockUSDC.connect(user2Account).approve(await depositVault.getAddress(), usdcAmount);

        // Mint DAI for payment token tests
        await mockDAI.mint(await deployer.getAddress(), ethers.parseUnits("100000", 18));

        // Mint zOPAL for redemption tests
        await zToken.mint(await userAccount.getAddress(), ethers.parseUnits("100000", 18));
        await zToken.connect(userAccount).approve(await redemptionVault.getAddress(), ethers.MaxUint256);

        // Fund redemption vault with USDC
        await mockUSDC.mint(await redemptionVault.getAddress(), ethers.parseUnits("100000", 6));

        return {
            depositVault, redemptionVault, zToken, mockUSDC, mockDAI,
            priceOracle, stablecoinOracle, accessControl,
            deployer, userAccount, user2Account, unauthorizedAccount,
            tokensReceiverAccount, feeReceiverAccount, requestRedeemerAccount
        };
    }

    beforeEach(async function () {
        const fixture = await loadFixture(deployFlowFixture);
        depositVault = fixture.depositVault;
        redemptionVault = fixture.redemptionVault;
        zToken = fixture.zToken;
        mockUSDC = fixture.mockUSDC;
        mockDAI = fixture.mockDAI;
        priceOracle = fixture.priceOracle;
        stablecoinOracle = fixture.stablecoinOracle;
        owner = fixture.deployer;
        user = fixture.userAccount;
        user2 = fixture.user2Account;
        unauthorized = fixture.unauthorizedAccount;
        tokensReceiver = fixture.tokensReceiverAccount;
        requestRedeemer = fixture.requestRedeemerAccount;
    });

    describe("Audit — Admin Bypass (#27, #28)", function () {
        it("#27 VAULT_ADMIN can approveRequest with arbitrary rate without oracle check", async function () {
            // Create a redemption request at current rate ($1)
            const redeemAmount = ethers.parseUnits("1000", 18);
            await redemptionVault.connect(user).redeemRequest(
                await mockUSDC.getAddress(), redeemAmount
            );

            // Admin sets USDC allowance for the request redeemer
            await mockUSDC.mint(await requestRedeemer.getAddress(), ethers.parseUnits("10000", 6));
            await mockUSDC.connect(requestRedeemer).approve(
                await redemptionVault.getAddress(), ethers.MaxUint256
            );

            // Admin approves at an arbitrary rate — no oracle validation
            const arbitraryRate = ethers.parseUnits("1.5", 18); // $1.50, different from oracle
            await expect(
                redemptionVault.connect(owner).approveRequest(0, arbitraryRate)
            ).to.emit(redemptionVault, "ApproveRequest");

            const request = await redemptionVault.redeemRequests(0);
            expect(request.status).to.equal(1); // Processed
        });

        it("#28 Non-VAULT_ADMIN calling approveRequest → reverts (WZAC: hasnt role)", async function () {
            // Create request
            const redeemAmount = ethers.parseUnits("1000", 18);
            await redemptionVault.connect(user).redeemRequest(
                await mockUSDC.getAddress(), redeemAmount
            );

            await expect(
                redemptionVault.connect(unauthorized).approveRequest(0, ethers.parseUnits("1", 18))
            ).to.be.revertedWith("WZAC: hasnt role");
        });
    });

    describe("Deposit Flow (#45, #47, #51)", function () {
        it("#45 minReceiveAmount slippage — NAV doubles, user gets half expected → reverts", async function () {
            // Simulate price doubling after user sets a minReceiveAmount expectation
            // User expects at least 900 zOPAL at $1 NAV for 1000 USDC
            const depositAmount = ethers.parseUnits("1000", 6);
            const minReceive = ethers.parseUnits("900", 18);

            // NAV jumps to $2 before tx (within 100% tolerance set in fixture)
            await priceOracle.setPrice(ethers.parseUnits("2", 8));

            // At $2 NAV, 1000 USDC → ~500 zOPAL, which is < 900 → should revert
            await expect(
                depositVault.connect(user).depositInstant(
                    await mockUSDC.getAddress(),
                    depositAmount,
                    minReceive,
                    ethers.ZeroHash
                )
            ).to.be.revertedWith("DV: minReceiveAmount > actual");
        });

        it("#47 Deposit request → admin approves → zOPAL minted to user", async function () {
            const depositAmount = ethers.parseUnits("1000", 6);

            // Step 1: user creates deposit request
            const tx = await depositVault.connect(user).depositRequest(
                await mockUSDC.getAddress(),
                depositAmount,
                ethers.ZeroHash
            );
            await expect(tx).to.emit(depositVault, "DepositRequest");

            const zBalanceBefore = await zToken.balanceOf(await user.getAddress());

            // Step 2: admin approves at current rate
            const currentRate = ethers.parseUnits("1", 18);
            await expect(
                depositVault.connect(owner).approveRequest(0, currentRate)
            ).to.emit(depositVault, "ApproveRequest");

            const zBalanceAfter = await zToken.balanceOf(await user.getAddress());

            // zOPAL should have been minted to the user
            expect(zBalanceAfter).to.be.greaterThan(zBalanceBefore);
        });

        it("#51 Deposit with non-whitelisted ERC-20 token → reverts", async function () {
            // Deploy a random token not added to the vault
            const MockTokenFactory = await ethers.getContractFactory("MockERC20");
            const randomToken = await MockTokenFactory.deploy("Random", "RND", 18);
            await randomToken.mint(await user.getAddress(), ethers.parseUnits("1000", 18));
            await randomToken.connect(user).approve(await depositVault.getAddress(), ethers.parseUnits("1000", 18));

            await expect(
                depositVault.connect(user).depositInstant(
                    await randomToken.getAddress(),
                    ethers.parseUnits("1000", 18),
                    0,
                    ethers.ZeroHash
                )
            ).to.be.revertedWith("MV: token not exists");
        });
    });

    describe("Fee Math (#54, #55)", function () {
        it("#54 Instant fee math: received USDC = (zOPAL redeemed - 0.5% instantFee) × NAV", async function () {
            // Vault config: instantFee = 50 (0.5%), tokenFee = 10 (0.1%), NAV = $1
            // Total instant fee = instantFee + tokenFee = 50 + 10 = 60 (0.6%)
            // But for #54 specifically, test with zero token fee to isolate instantFee = 0.5%
            // Add a zero-fee token
            const MockTokenFactory = await ethers.getContractFactory("MockERC20");
            const mockToken = await MockTokenFactory.deploy("Test", "TST", 6);

            const FunctionsACFactory = await ethers.getContractFactory("FunctionsAccessControl");
            const fac = await FunctionsACFactory.deploy(await owner.getAddress());
            await fac.grantPriceAdminRole(await owner.getAddress());
            const PriceOracleFactory = await ethers.getContractFactory("PriceOracle");
            const tokenOracle = await PriceOracleFactory.deploy(await fac.getAddress(), 8, 500, 86400 * 365);
            await tokenOracle.setPrice(ethers.parseUnits("1", 8));

            await redemptionVault.addPaymentToken(
                await mockToken.getAddress(),
                await tokenOracle.getAddress(),
                0, // zero token fee → pure 0.5% instant fee
                true
            );
            await redemptionVault.changeTokenAllowance(await mockToken.getAddress(), ethers.MaxUint256);
            await mockToken.mint(await redemptionVault.getAddress(), ethers.parseUnits("10000", 6));

            const redeemAmount = ethers.parseUnits("1000", 18); // 1000 zOPAL at $1 NAV
            const userBefore = await mockToken.balanceOf(await user.getAddress());

            await redemptionVault.connect(user).redeemInstant(
                await mockToken.getAddress(),
                redeemAmount,
                0
            );

            const userAfter = await mockToken.balanceOf(await user.getAddress());
            const received = userAfter - userBefore;

            // Expected: 1000 - 0.5% = 995 tokens (in 6 decimals = 995,000,000)
            const expected = ethers.parseUnits("995", 6);
            expect(received).to.equal(expected);
        });

        it("#55 Standard request fee math: USDC = (zOPAL - 0.1% tokenFee) × NAV", async function () {
            // Standard redemption: isInstant=false, tokenFee=10 (0.1%), no instantFee applied
            // fee = 1000 * 10 / 10000 = 1 zOPAL
            // amountWithoutFee = 999 zOPAL → at $1 NAV → 999 USDC
            const redeemAmount = ethers.parseUnits("1000", 18);

            // Create standard redeem request
            await redemptionVault.connect(user).redeemRequest(
                await mockUSDC.getAddress(),
                redeemAmount
            );

            // Set up request redeemer with USDC
            await mockUSDC.mint(await requestRedeemer.getAddress(), ethers.parseUnits("10000", 6));
            await mockUSDC.connect(requestRedeemer).approve(
                await redemptionVault.getAddress(), ethers.MaxUint256
            );

            const userUSDCBefore = await mockUSDC.balanceOf(await user.getAddress());

            // Admin approves at $1 rate
            await redemptionVault.connect(owner).approveRequest(0, ethers.parseUnits("1", 18));

            const userUSDCAfter = await mockUSDC.balanceOf(await user.getAddress());
            const received = userUSDCAfter - userUSDCBefore;

            // Expected: 999 USDC (999 zOPAL × $1 NAV, fee=1 zOPAL at 0.1%)
            const expected = ethers.parseUnits("999", 6);
            expect(received).to.equal(expected);
        });
    });

    describe("Token Behaviour (#59, #60)", function () {
        it("#59 Mint increases totalSupply correctly", async function () {
            const supplyBefore = await zToken.totalSupply();
            const mintAmount = ethers.parseUnits("5000", 18);

            // Deposit to trigger mint
            const depositAmount = ethers.parseUnits("5000", 6); // $5000 at $1 NAV → 5000 zOPAL
            await depositVault.connect(user).depositInstant(
                await mockUSDC.getAddress(), depositAmount, 0, ethers.ZeroHash
            );

            const supplyAfter = await zToken.totalSupply();
            expect(supplyAfter - supplyBefore).to.equal(mintAmount);
        });

        it("#60 Burn decreases totalSupply correctly", async function () {
            const supplyBefore = await zToken.totalSupply();

            const redeemAmount = ethers.parseUnits("1000", 18);
            await redemptionVault.connect(user).redeemInstant(
                await mockUSDC.getAddress(),
                redeemAmount,
                0
            );

            const supplyAfter = await zToken.totalSupply();
            expect(supplyAfter).to.be.lessThan(supplyBefore);
            // instantFee=50 (0.5%) + tokenFee=10 (0.1%) = 60 bps total
            // fee = 1000 * 60 / 10000 = 6 zOPAL → transferred to feeReceiver (NOT burned)
            // only amountWithoutFee = 994 zOPAL is burned → totalSupply drops by 994
            const fee = redeemAmount * 60n / 10000n;
            expect(supplyBefore - supplyAfter).to.equal(redeemAmount - fee);
        });
    });

    describe("Token Behaviour — Multiple Deposits at Different NAVs (#62)", function () {
        it("#62 Multiple deposits at different NAVs → proportional zOPAL shares", async function () {
            // User1 deposits 1000 USDC at NAV=$1 → receives 1000 zOPAL
            const depositAmount = ethers.parseUnits("1000", 6);
            await depositVault.connect(user).depositInstant(
                await mockUSDC.getAddress(), depositAmount, 0, ethers.ZeroHash
            );
            const zBalanceUser1 = await zToken.balanceOf(await user.getAddress());
            // Account for pre-minted balance in fixture
            const zMintedToUser1 = zBalanceUser1 - ethers.parseUnits("100000", 18);

            // NAV doubles to $2
            await priceOracle.setPrice(ethers.parseUnits("2", 8));

            // User2 deposits 1000 USDC at NAV=$2 → receives 500 zOPAL
            await depositVault.connect(user2).depositInstant(
                await mockUSDC.getAddress(), depositAmount, 0, ethers.ZeroHash
            );
            const zBalanceUser2 = await zToken.balanceOf(await user2.getAddress());

            // User1 got ~1000 zOPAL, User2 got ~500 zOPAL for same USDC input
            expect(zMintedToUser1).to.be.closeTo(ethers.parseUnits("1000", 18), ethers.parseUnits("1", 18));
            expect(zBalanceUser2).to.be.closeTo(ethers.parseUnits("500", 18), ethers.parseUnits("1", 18));

            // User1 has ~2x shares of User2 for same USDC investment → correct proportional representation
            expect(zMintedToUser1).to.be.closeTo(zBalanceUser2 * 2n, ethers.parseUnits("5", 18));
        });
    });

    describe("Payment Token Config (#75, #76, #77)", function () {
        it("#75 Deposit with USDC (whitelisted) → succeeds", async function () {
            const depositAmount = ethers.parseUnits("1000", 6);
            await expect(
                depositVault.connect(user).depositInstant(
                    await mockUSDC.getAddress(), depositAmount, 0, ethers.ZeroHash
                )
            ).to.emit(depositVault, "DepositInstant");
        });

        it("#76 Add new payment token at runtime → deposits succeed end-to-end", async function () {
            // Add DAI as payment token
            const FunctionsACFactory = await ethers.getContractFactory("FunctionsAccessControl");
            const fac = await FunctionsACFactory.deploy(await owner.getAddress());
            await fac.grantPriceAdminRole(await owner.getAddress());
            const PriceOracleFactory = await ethers.getContractFactory("PriceOracle");
            const daiOracle = await PriceOracleFactory.deploy(await fac.getAddress(), 8, 500, 86400 * 365);
            await daiOracle.setPrice(ethers.parseUnits("1", 8));

            await depositVault.addPaymentToken(
                await mockDAI.getAddress(),
                await daiOracle.getAddress(),
                0,
                ethers.parseUnits("1000000", 18),
                true
            );

            // Mint DAI to user and approve
            await mockDAI.mint(await user.getAddress(), ethers.parseUnits("1000", 18));
            await mockDAI.connect(user).approve(await depositVault.getAddress(), ethers.parseUnits("1000", 18));

            // Deposit with newly added DAI should succeed
            await expect(
                depositVault.connect(user).depositInstant(
                    await mockDAI.getAddress(),
                    ethers.parseUnits("1000", 18),
                    0,
                    ethers.ZeroHash
                )
            ).to.emit(depositVault, "DepositInstant");
        });

        it("#77 Remove payment token → deposits with that token revert", async function () {
            // Remove USDC from allowed payment tokens
            await depositVault.removePaymentToken(await mockUSDC.getAddress());

            const depositAmount = ethers.parseUnits("1000", 6);
            await expect(
                depositVault.connect(user).depositInstant(
                    await mockUSDC.getAddress(), depositAmount, 0, ethers.ZeroHash
                )
            ).to.be.revertedWith("MV: token not exists");
        });

        it("#77 (cont.) Trying to re-add removed token and deposit → succeeds", async function () {
            // Remove and re-add USDC
            await depositVault.removePaymentToken(await mockUSDC.getAddress());
            await depositVault.addPaymentToken(
                await mockUSDC.getAddress(),
                await stablecoinOracle.getAddress(),
                0, ethers.parseUnits("1000000", 18), true
            );

            const depositAmount = ethers.parseUnits("1000", 6);
            await expect(
                depositVault.connect(user).depositInstant(
                    await mockUSDC.getAddress(), depositAmount, 0, ethers.ZeroHash
                )
            ).to.emit(depositVault, "DepositInstant");
        });
    });
});
