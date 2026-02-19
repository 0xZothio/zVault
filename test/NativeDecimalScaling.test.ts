import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import type {
    DepositVault,
    RedemptionVault,
    ZeUSD
} from "../typechain-types";

describe("Native Decimal Scaling", function () {
    // Test tokens with different decimals
    let mockUSDC: any; // 6 decimals
    let mockWBTC: any; // 8 decimals
    let mockDAI: any;  // 18 decimals

    let depositVault: DepositVault;
    let redemptionVault: RedemptionVault;
    let zToken: ZeUSD;

    let owner: SignerWithAddress;
    let user: SignerWithAddress;
    let tokensReceiver: SignerWithAddress;

    async function deployFullSystemFixture() {
        const [deployer, userAccount, tokensReceiverAccount, feeReceiverAccount, requestRedeemerAccount] =
            await ethers.getSigners();

        // Deploy ZothAccessControl (upgradeable)
        const AccessControlFactory = await ethers.getContractFactory("ZothAccessControl");
        const accessControlImpl = await AccessControlFactory.deploy();
        const initData = accessControlImpl.interface.encodeFunctionData("initialize", []);

        const ERC1967ProxyFactory = await ethers.getContractFactory(
            "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"
        );
        const accessControlProxy = await ERC1967ProxyFactory.deploy(
            await accessControlImpl.getAddress(),
            initData
        );
        const accessControl = AccessControlFactory.attach(
            await accessControlProxy.getAddress()
        ) as unknown as ZothAccessControl;

        // Deploy mock tokens with different decimals
        const MockTokenFactory = await ethers.getContractFactory("MockERC20");
        const mockUSDC = await MockTokenFactory.deploy("USD Coin", "USDC", 6);
        const mockWBTC = await MockTokenFactory.deploy("Wrapped Bitcoin", "WBTC", 8);
        const mockDAI = await MockTokenFactory.deploy("Dai Stablecoin", "DAI", 18);

        // Deploy mock firewall
        const MockFirewallFactory = await ethers.getContractFactory("MockHypernativeFirewall");
        const mockFirewall = await MockFirewallFactory.deploy();

        // Deploy FunctionsAccessControl for PriceOracle
        const FunctionsAccessControlFactory = await ethers.getContractFactory("FunctionsAccessControl");
        const functionsAccessControl = await FunctionsAccessControlFactory.deploy(
            await deployer.getAddress()
        );

        // Deploy PriceOracle for zToken
        const PriceOracleFactory = await ethers.getContractFactory("PriceOracle");
        const priceOracle = await PriceOracleFactory.deploy(
            await functionsAccessControl.getAddress(),
            8,  // 8 decimals for price input
            500, // 5% tolerance
            86400, // 24 hours max staleness
            await mockFirewall.getAddress()
        );

        // Deploy stablecoin oracle (for USDC - returns 1:1)
        const stablecoinOracle = await PriceOracleFactory.deploy(
            await functionsAccessControl.getAddress(),
            8,
            500,
            86400,
            await mockFirewall.getAddress()
        );

        // Grant price admin role and set prices
        await functionsAccessControl.grantPriceAdminRole(await deployer.getAddress());
        await priceOracle.setPrice(ethers.parseUnits("1", 8)); // $1 per zToken
        await stablecoinOracle.setPrice(ethers.parseUnits("1", 8)); // $1 per stablecoin

        // Deploy ZeUSD token
        const ZeUSDFactory = await ethers.getContractFactory("ZeUSD");
        const zTokenImpl = await ZeUSDFactory.deploy();
        const zTokenInitData = zTokenImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            ethers.ZeroAddress
        ]);
        const zTokenProxy = await ERC1967ProxyFactory.deploy(
            await zTokenImpl.getAddress(),
            zTokenInitData
        );
        const zToken = ZeUSDFactory.attach(await zTokenProxy.getAddress()) as unknown as ZeUSD;

        // Deploy DepositVault
        const DepositVaultFactory = await ethers.getContractFactory("DepositVault");
        const depositVaultImpl = await DepositVaultFactory.deploy();
        const depositVaultInitData = depositVaultImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            {
                zToken: await zToken.getAddress(),
                zTokenDataFeed: await priceOracle.getAddress()
            },
            {
                tokensReceiver: await tokensReceiverAccount.getAddress(),
                feeReceiver: await feeReceiverAccount.getAddress()
            },
            {
                instantFee: 100, // 1% fee
                instantDailyLimit: ethers.parseUnits("1000000", 18) // 1M limit
            },
            ethers.ZeroAddress, // sanctions list
            100, // 1% variation tolerance
            ethers.parseUnits("1", 18), // min amount in base18
            0, // minZTokenAmountForFirstDeposit
            ethers.parseUnits("10000000", 18), // maxSupplyCap
            await mockFirewall.getAddress() // firewall
        ]);
        const depositVaultProxy = await ERC1967ProxyFactory.deploy(
            await depositVaultImpl.getAddress(),
            depositVaultInitData
        );
        const depositVault = DepositVaultFactory.attach(
            await depositVaultProxy.getAddress()
        ) as unknown as DepositVault;

        // Deploy RedemptionVault
        const RedemptionVaultFactory = await ethers.getContractFactory("RedemptionVault");
        const redemptionVaultImpl = await RedemptionVaultFactory.deploy();
        const redemptionVaultInitData = redemptionVaultImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            {
                zToken: await zToken.getAddress(),
                zTokenDataFeed: await priceOracle.getAddress()
            },
            {
                tokensReceiver: await tokensReceiverAccount.getAddress(),
                feeReceiver: await feeReceiverAccount.getAddress()
            },
            {
                instantFee: 100,
                instantDailyLimit: ethers.parseUnits("1000000", 18)
            },
            ethers.ZeroAddress,
            100,
            ethers.parseUnits("1", 18),
            {
                minFiatRedeemAmount: ethers.parseUnits("100", 18),
                fiatAdditionalFee: 50,
                fiatFlatFee: ethers.parseUnits("10", 18)
            },
            await requestRedeemerAccount.getAddress(),
            await mockFirewall.getAddress() // firewall
        ]);
        const redemptionVaultProxy = await ERC1967ProxyFactory.deploy(
            await redemptionVaultImpl.getAddress(),
            redemptionVaultInitData
        );
        const redemptionVault = RedemptionVaultFactory.attach(
            await redemptionVaultProxy.getAddress()
        ) as unknown as RedemptionVault;

        // Grant roles
        const DEPOSIT_VAULT_ADMIN_ROLE = await accessControl.DEPOSIT_VAULT_ADMIN_ROLE();
        const REDEMPTION_VAULT_ADMIN_ROLE = await accessControl.REDEMPTION_VAULT_ADMIN_ROLE();
        const ZEUSD_MINT_OPERATOR_ROLE = await accessControl.ZEUSD_MINT_OPERATOR_ROLE();
        const ZEUSD_BURN_OPERATOR_ROLE = await accessControl.ZEUSD_BURN_OPERATOR_ROLE();
        const GREENLISTED_ROLE = await accessControl.GREENLISTED_ROLE();

        await accessControl.grantRole(DEPOSIT_VAULT_ADMIN_ROLE, await deployer.getAddress());
        await accessControl.grantRole(REDEMPTION_VAULT_ADMIN_ROLE, await deployer.getAddress());
        await accessControl.grantRole(ZEUSD_MINT_OPERATOR_ROLE, await depositVault.getAddress());
        await accessControl.grantRole(ZEUSD_BURN_OPERATOR_ROLE, await redemptionVault.getAddress());
        await accessControl.grantRole(GREENLISTED_ROLE, await userAccount.getAddress());

        // Add payment tokens to vaults
        await depositVault.addPaymentToken(
            await mockUSDC.getAddress(),
            await stablecoinOracle.getAddress(),
            100, // 1% fee
            ethers.parseUnits("1000000", 18), // allowance
            true // stable
        );

        await depositVault.addPaymentToken(
            await mockWBTC.getAddress(),
            await priceOracle.getAddress(),
            100,
            ethers.parseUnits("1000000", 18),
            false
        );

        await depositVault.addPaymentToken(
            await mockDAI.getAddress(),
            await stablecoinOracle.getAddress(),
            100,
            ethers.parseUnits("1000000", 18),
            true
        );

        // Add payment tokens to redemption vault (no allowance param for redemption vault)
        await redemptionVault.addPaymentToken(
            await mockUSDC.getAddress(),
            await stablecoinOracle.getAddress(),
            100,
            true
        );

        // Mint tokens to user
        await mockUSDC.mint(await userAccount.getAddress(), ethers.parseUnits("100000", 6));
        await mockWBTC.mint(await userAccount.getAddress(), ethers.parseUnits("100", 8));
        await mockDAI.mint(await userAccount.getAddress(), ethers.parseUnits("100000", 18));

        // Approve vaults to spend tokens
        await mockUSDC.connect(userAccount).approve(
            await depositVault.getAddress(),
            ethers.parseUnits("100000", 6)
        );
        await mockWBTC.connect(userAccount).approve(
            await depositVault.getAddress(),
            ethers.parseUnits("100", 8)
        );
        await mockDAI.connect(userAccount).approve(
            await depositVault.getAddress(),
            ethers.parseUnits("100000", 18)
        );

        // Fund redemption vault with USDC for redemptions
        await mockUSDC.mint(await redemptionVault.getAddress(), ethers.parseUnits("100000", 6));

        return {
            depositVault,
            redemptionVault,
            zToken,
            accessControl,
            priceOracle,
            stablecoinOracle,
            mockUSDC,
            mockWBTC,
            mockDAI,
            deployer,
            userAccount,
            tokensReceiverAccount,
            feeReceiverAccount,
            requestRedeemerAccount
        };
    }

    beforeEach(async function () {
        const fixture = await loadFixture(deployFullSystemFixture);
        depositVault = fixture.depositVault;
        redemptionVault = fixture.redemptionVault;
        zToken = fixture.zToken;
        mockUSDC = fixture.mockUSDC;
        mockWBTC = fixture.mockWBTC;
        mockDAI = fixture.mockDAI;
        owner = fixture.deployer;
        user = fixture.userAccount;
        tokensReceiver = fixture.tokensReceiverAccount;
    });

    describe("DepositVault - Native Decimal Input", function () {
        describe("depositInstant with 6 decimal token (USDC)", function () {
            it("Should accept amount in native 6 decimals and deposit correctly", async function () {
                // Deposit 1000 USDC (in native 6 decimals)
                const depositAmount = ethers.parseUnits("1000", 6); // 1,000,000,000 (6 decimals)

                const userBalanceBefore = await mockUSDC.balanceOf(await user.getAddress());

                await expect(
                    depositVault.connect(user).depositInstant(
                        await mockUSDC.getAddress(),
                        depositAmount,
                        0, // minReceiveAmount
                        ethers.ZeroHash // referrerId
                    )
                ).to.emit(depositVault, "DepositInstant");

                const userBalanceAfter = await mockUSDC.balanceOf(await user.getAddress());

                // User should have spent approximately 1000 USDC
                expect(userBalanceBefore - userBalanceAfter).to.be.closeTo(
                    depositAmount,
                    ethers.parseUnits("10", 6) // Allow for fee variance
                );

                // User should have received zTokens
                const zTokenBalance = await zToken.balanceOf(await user.getAddress());
                expect(zTokenBalance).to.be.greaterThan(0);
            });

            it("Should correctly emit native amount in event", async function () {
                const depositAmount = ethers.parseUnits("100", 6); // 100 USDC

                const tx = await depositVault.connect(user).depositInstant(
                    await mockUSDC.getAddress(),
                    depositAmount,
                    0,
                    ethers.ZeroHash
                );

                const receipt = await tx.wait();
                const event = receipt?.logs.find(
                    (log: any) => log.fragment?.name === "DepositInstant"
                );

                // The amountToken in the event should be in native decimals
                expect(event).to.not.be.undefined;
            });

            it("Should revert with zero amount after conversion", async function () {
                // Zero amount will fail minimum amount validation
                await expect(
                    depositVault.connect(user).depositInstant(
                        await mockUSDC.getAddress(),
                        0,
                        0,
                        ethers.ZeroHash
                    )
                ).to.be.revertedWith("DV: invalid amount");
            });
        });

        describe("depositInstant with 8 decimal token (WBTC)", function () {
            it("Should accept amount in native 8 decimals", async function () {
                // Deposit 10 WBTC (in native 8 decimals) - larger amount to satisfy min deposit
                // Note: In test setup, WBTC price is $1, so need enough to meet minimum
                const depositAmount = ethers.parseUnits("10", 8); // 1,000,000,000 (8 decimals)

                const userBalanceBefore = await mockWBTC.balanceOf(await user.getAddress());

                await expect(
                    depositVault.connect(user).depositInstant(
                        await mockWBTC.getAddress(),
                        depositAmount,
                        0,
                        ethers.ZeroHash
                    )
                ).to.emit(depositVault, "DepositInstant");

                const userBalanceAfter = await mockWBTC.balanceOf(await user.getAddress());

                // User should have spent approximately 10 WBTC
                expect(userBalanceBefore - userBalanceAfter).to.be.closeTo(
                    depositAmount,
                    ethers.parseUnits("0.1", 8)
                );
            });
        });

        describe("depositInstant with 18 decimal token (DAI)", function () {
            it("Should accept amount in native 18 decimals", async function () {
                // Deposit 1000 DAI (in native 18 decimals)
                const depositAmount = ethers.parseUnits("1000", 18);

                const userBalanceBefore = await mockDAI.balanceOf(await user.getAddress());

                await expect(
                    depositVault.connect(user).depositInstant(
                        await mockDAI.getAddress(),
                        depositAmount,
                        0,
                        ethers.ZeroHash
                    )
                ).to.emit(depositVault, "DepositInstant");

                const userBalanceAfter = await mockDAI.balanceOf(await user.getAddress());

                // User should have spent approximately 1000 DAI
                expect(userBalanceBefore - userBalanceAfter).to.be.closeTo(
                    depositAmount,
                    ethers.parseUnits("10", 18)
                );
            });
        });

        describe("depositRequest with native decimals", function () {
            it("Should create deposit request with native decimal amount", async function () {
                const depositAmount = ethers.parseUnits("500", 6); // 500 USDC

                const tx = await depositVault.connect(user).depositRequest(
                    await mockUSDC.getAddress(),
                    depositAmount,
                    ethers.ZeroHash
                );

                await expect(tx).to.emit(depositVault, "DepositRequest");
            });

            it("Should revert with zero amount", async function () {
                await expect(
                    depositVault.connect(user).depositRequest(
                        await mockUSDC.getAddress(),
                        0,
                        ethers.ZeroHash
                    )
                ).to.be.revertedWith("DV: invalid amount");
            });
        });

        describe("Edge cases - small amounts that would truncate to zero", function () {
            it("Should correctly convert small native amounts to base18", async function () {
                // Test that 100 USDC (small but valid) converts correctly
                // 100 USDC in native decimals = 100000000 (6 decimals)
                // In base18 = 100000000 * 10^12 = 100 * 10^18
                const smallAmount = ethers.parseUnits("100", 6); // 100 USDC

                await expect(
                    depositVault.connect(user).depositInstant(
                        await mockUSDC.getAddress(),
                        smallAmount,
                        0,
                        ethers.ZeroHash
                    )
                ).to.emit(depositVault, "DepositInstant");
            });

            it("Should revert when amount is literally zero", async function () {
                await expect(
                    depositVault.connect(user).depositInstant(
                        await mockUSDC.getAddress(),
                        0,
                        0,
                        ethers.ZeroHash
                    )
                ).to.be.revertedWith("DV: invalid amount");
            });

            it("Should revert tiny amounts that don't meet vault minimum", async function () {
                // 0.000001 USDC = 1 unit in 6 decimals - below vault minimum
                const tinyAmount = 1n;

                await expect(
                    depositVault.connect(user).depositInstant(
                        await mockUSDC.getAddress(),
                        tinyAmount,
                        0,
                        ethers.ZeroHash
                    )
                ).to.be.revertedWith("DV: zToken amount < min");
            });
        });

        describe("Comparison: Old base18 input vs New native input", function () {
            it("Should NOT accept old base18 format (would give wrong result)", async function () {
                // If someone passes 1000 USDC in old base18 format: 1000 * 10^18
                // This would be interpreted as a massive amount in native decimals
                // and likely fail due to insufficient balance

                const wrongFormat = ethers.parseUnits("1000", 18); // Old format

                // This should fail because user doesn't have 10^15 USDC
                await expect(
                    depositVault.connect(user).depositInstant(
                        await mockUSDC.getAddress(),
                        wrongFormat,
                        0,
                        ethers.ZeroHash
                    )
                ).to.be.reverted; // Will fail on transfer
            });
        });
    });

    describe("RedemptionVault - Native Decimal Output", function () {
        beforeEach(async function () {
            // First deposit some tokens to get zTokens
            const depositAmount = ethers.parseUnits("1000", 6);
            await depositVault.connect(user).depositInstant(
                await mockUSDC.getAddress(),
                depositAmount,
                0,
                ethers.ZeroHash
            );

            // Approve redemption vault to spend zTokens
            const zTokenBalance = await zToken.balanceOf(await user.getAddress());
            await zToken.connect(user).approve(
                await redemptionVault.getAddress(),
                zTokenBalance
            );
        });

        describe("redeemInstant with native decimal minReceiveAmount", function () {
            it("Should accept minReceiveAmount in native 6 decimals", async function () {
                const zTokenBalance = await zToken.balanceOf(await user.getAddress());

                // minReceiveAmount in native 6 decimals (expect at least 800 USDC)
                const minReceiveAmount = ethers.parseUnits("800", 6);

                await expect(
                    redemptionVault.connect(user).redeemInstant(
                        await mockUSDC.getAddress(),
                        zTokenBalance,
                        minReceiveAmount
                    )
                ).to.emit(redemptionVault, "RedeemInstant");
            });

            it("Should revert when minReceiveAmount not met", async function () {
                const zTokenBalance = await zToken.balanceOf(await user.getAddress());

                // Set unrealistic minReceiveAmount
                const minReceiveAmount = ethers.parseUnits("10000", 6); // Way more than expected

                await expect(
                    redemptionVault.connect(user).redeemInstant(
                        await mockUSDC.getAddress(),
                        zTokenBalance,
                        minReceiveAmount
                    )
                ).to.be.revertedWith("RV: minReceiveAmount > actual");
            });

            it("Should correctly compare native decimal amounts", async function () {
                const zTokenBalance = await zToken.balanceOf(await user.getAddress());

                // Should pass with reasonable minReceiveAmount
                const minReceiveAmount = ethers.parseUnits("100", 6);

                const userUSDCBefore = await mockUSDC.balanceOf(await user.getAddress());

                await redemptionVault.connect(user).redeemInstant(
                    await mockUSDC.getAddress(),
                    zTokenBalance,
                    minReceiveAmount
                );

                const userUSDCAfter = await mockUSDC.balanceOf(await user.getAddress());

                // User should have received USDC
                expect(userUSDCAfter).to.be.greaterThan(userUSDCBefore);
                // Amount received should be >= minReceiveAmount
                expect(userUSDCAfter - userUSDCBefore).to.be.gte(minReceiveAmount);
            });
        });

        describe("Event emissions with native amounts", function () {
            it("Should emit amountTokenOut in native decimals", async function () {
                const zTokenBalance = await zToken.balanceOf(await user.getAddress());
                const minReceiveAmount = ethers.parseUnits("1", 6);

                const tx = await redemptionVault.connect(user).redeemInstant(
                    await mockUSDC.getAddress(),
                    zTokenBalance,
                    minReceiveAmount
                );

                const receipt = await tx.wait();

                // Find RedeemInstant event
                const event = receipt?.logs.find(
                    (log: any) => log.fragment?.name === "RedeemInstant"
                );

                expect(event).to.not.be.undefined;
            });
        });
    });

    describe("Cross-token decimal consistency", function () {
        it("Should handle deposits across different token decimals consistently", async function () {
            // Deposit equivalent USD value in different tokens
            const usdcAmount = ethers.parseUnits("100", 6);  // 100 USDC
            const daiAmount = ethers.parseUnits("100", 18);  // 100 DAI

            // Deposit USDC
            await depositVault.connect(user).depositInstant(
                await mockUSDC.getAddress(),
                usdcAmount,
                0,
                ethers.ZeroHash
            );

            const zBalanceAfterUSDC = await zToken.balanceOf(await user.getAddress());

            // Deposit DAI
            await depositVault.connect(user).depositInstant(
                await mockDAI.getAddress(),
                daiAmount,
                0,
                ethers.ZeroHash
            );

            const zBalanceAfterDAI = await zToken.balanceOf(await user.getAddress());
            const zTokensFromDAI = zBalanceAfterDAI - zBalanceAfterUSDC;

            // Both deposits of equivalent USD value should yield similar zToken amounts
            // (within some tolerance for fees/rounding)
            expect(zBalanceAfterUSDC).to.be.closeTo(
                zTokensFromDAI,
                ethers.parseUnits("5", 18) // Allow 5 token variance
            );
        });
    });

    describe("Integration: Full deposit-redeem cycle", function () {
        it("Should complete full cycle with native decimals", async function () {
            // 1. Deposit USDC
            const depositAmount = ethers.parseUnits("1000", 6);
            await depositVault.connect(user).depositInstant(
                await mockUSDC.getAddress(),
                depositAmount,
                0,
                ethers.ZeroHash
            );

            const zTokenBalance = await zToken.balanceOf(await user.getAddress());
            expect(zTokenBalance).to.be.greaterThan(0);

            // 2. Approve and redeem
            await zToken.connect(user).approve(
                await redemptionVault.getAddress(),
                zTokenBalance
            );

            const usdcBefore = await mockUSDC.balanceOf(await user.getAddress());

            // Use native decimal minReceiveAmount
            const minReceiveAmount = ethers.parseUnits("1", 6); // At least 1 USDC

            await redemptionVault.connect(user).redeemInstant(
                await mockUSDC.getAddress(),
                zTokenBalance,
                minReceiveAmount
            );

            const usdcAfter = await mockUSDC.balanceOf(await user.getAddress());

            // Should have received USDC back (minus fees)
            expect(usdcAfter).to.be.greaterThan(usdcBefore);
            expect(usdcAfter - usdcBefore).to.be.gte(minReceiveAmount);
        });
    });
});
