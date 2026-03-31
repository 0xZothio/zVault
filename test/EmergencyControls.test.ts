import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Test suite covering emergency controls and pause functionality:
 * #38  - Non-admin wallet tries pause → reverts
 * #49  - Deposit with paused contract → reverts
 * #57  - Redemption with paused contract → reverts
 * #58  - zOPAL transfer with contract paused → reverts
 * #66  - Pause deposits → all deposit txs revert
 * #67  - Pause redemptions → all redeem txs revert
 * #68  - Unpause → operations resume normally
 * #69  - Pause → pending request-based flows frozen (new requests blocked)
 */
describe("Emergency Controls", function () {
    let depositVault: any;
    let redemptionVault: any;
    let zToken: any;
    let mockUSDC: any;

    let owner: SignerWithAddress;
    let user: SignerWithAddress;
    let unauthorized: SignerWithAddress;

    async function deployEmergencyFixture() {
        const [deployer, userAccount, unauthorizedAccount, tokensReceiver, feeReceiver, requestRedeemer] =
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

        const DepositVaultFactory = await ethers.getContractFactory("DepositVault");
        const depositVaultImpl = await DepositVaultFactory.deploy();
        const depositVaultInitData = depositVaultImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            { zToken: await zToken.getAddress(), zTokenDataFeed: await priceOracle.getAddress() },
            { tokensReceiver: await tokensReceiver.getAddress(), feeReceiver: await feeReceiver.getAddress() },
            { instantFee: 0, instantDailyLimit: ethers.parseUnits("1000000", 18) },
            ethers.ZeroAddress, 100, ethers.parseUnits("1", 18), 0,
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
            ethers.ZeroAddress, 100, ethers.parseUnits("1", 18),
            { minFiatRedeemAmount: ethers.parseUnits("1", 18), fiatAdditionalFee: 0, fiatFlatFee: 0 },
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
        await accessControl.grantRole(ZOPAL_MINT_OPERATOR_ROLE, await deployer.getAddress()); // for test setup
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

        // Mint zOPAL for redemption tests
        await zToken.mint(await userAccount.getAddress(), ethers.parseUnits("100000", 18));
        await zToken.connect(userAccount).approve(await redemptionVault.getAddress(), ethers.MaxUint256);
        await mockUSDC.mint(await redemptionVault.getAddress(), ethers.parseUnits("100000", 6));

        return {
            depositVault, redemptionVault, zToken, mockUSDC, accessControl,
            deployer, userAccount, unauthorizedAccount
        };
    }

    beforeEach(async function () {
        const fixture = await loadFixture(deployEmergencyFixture);
        depositVault = fixture.depositVault;
        redemptionVault = fixture.redemptionVault;
        zToken = fixture.zToken;
        mockUSDC = fixture.mockUSDC;
        owner = fixture.deployer;
        user = fixture.userAccount;
        unauthorized = fixture.unauthorizedAccount;
    });

    describe("#38 — Non-admin wallet tries pause → reverts", function () {
        it("Non-admin cannot pause DepositVault → reverts (WZAC: hasnt role)", async function () {
            await expect(
                depositVault.connect(unauthorized).pause()
            ).to.be.revertedWith("WZAC: hasnt role");
        });

        it("Non-admin cannot pause RedemptionVault → reverts (WZAC: hasnt role)", async function () {
            await expect(
                redemptionVault.connect(unauthorized).pause()
            ).to.be.revertedWith("WZAC: hasnt role");
        });

        it("Vault admin CAN pause DepositVault", async function () {
            await expect(
                depositVault.connect(owner).pause()
            ).to.not.be.reverted;
        });
    });

    describe("#49 — Deposit with paused DepositVault → reverts", function () {
        it("depositInstant reverts when contract is paused", async function () {
            await depositVault.connect(owner).pause();

            const depositAmount = ethers.parseUnits("1000", 6);
            await expect(
                depositVault.connect(user).depositInstant(
                    await mockUSDC.getAddress(), depositAmount, 0, ethers.ZeroHash
                )
            ).to.be.revertedWith("Pausable: paused");
        });

        it("depositRequest reverts when contract is paused", async function () {
            await depositVault.connect(owner).pause();

            await expect(
                depositVault.connect(user).depositRequest(
                    await mockUSDC.getAddress(),
                    ethers.parseUnits("1000", 6),
                    ethers.ZeroHash
                )
            ).to.be.revertedWith("Pausable: paused");
        });
    });

    describe("#57 — Redemption with paused RedemptionVault → reverts", function () {
        it("redeemInstant reverts when contract is paused", async function () {
            await redemptionVault.connect(owner).pause();

            await expect(
                redemptionVault.connect(user).redeemInstant(
                    await mockUSDC.getAddress(),
                    ethers.parseUnits("500", 18),
                    0
                )
            ).to.be.revertedWith("Pausable: paused");
        });

        it("redeemRequest reverts when contract is paused", async function () {
            await redemptionVault.connect(owner).pause();

            await expect(
                redemptionVault.connect(user).redeemRequest(
                    await mockUSDC.getAddress(),
                    ethers.parseUnits("500", 18)
                )
            ).to.be.revertedWith("Pausable: paused");
        });
    });

    describe("#58 — zOPAL transfer with zOPAL paused → reverts", function () {
        it("zOPAL transfer reverts when token contract is paused", async function () {
            // Pause the zOPAL token (requires ZOPAL_PAUSE_OPERATOR_ROLE)
            await zToken.connect(owner).pause();

            await expect(
                zToken.connect(user).transfer(await unauthorized.getAddress(), ethers.parseUnits("100", 18))
            ).to.be.revertedWith("ERC20Pausable: token transfer while paused");
        });

        it("zOPAL transfer succeeds after unpause", async function () {
            await zToken.connect(owner).pause();
            await zToken.connect(owner).unpause();

            await expect(
                zToken.connect(user).transfer(await unauthorized.getAddress(), ethers.parseUnits("100", 18))
            ).to.not.be.reverted;
        });
    });

    describe("#66 — Pause deposits → all deposit txs revert", function () {
        it("Contract-level pause blocks all deposit operations", async function () {
            await depositVault.connect(owner).pause();

            // Both instant and request deposits should revert
            await expect(
                depositVault.connect(user).depositInstant(
                    await mockUSDC.getAddress(), ethers.parseUnits("1000", 6), 0, ethers.ZeroHash
                )
            ).to.be.revertedWith("Pausable: paused");

            await expect(
                depositVault.connect(user).depositRequest(
                    await mockUSDC.getAddress(), ethers.parseUnits("1000", 6), ethers.ZeroHash
                )
            ).to.be.revertedWith("Pausable: paused");
        });

        it("Function-level pause (pauseFn) blocks only depositInstant", async function () {
            const depositInstantSelector = depositVault.interface.getFunction("depositInstant(address,uint256,uint256,bytes32)").selector;
            await depositVault.connect(owner).pauseFn(depositInstantSelector);

            // depositInstant is paused
            await expect(
                depositVault.connect(user).depositInstant(
                    await mockUSDC.getAddress(), ethers.parseUnits("1000", 6), 0, ethers.ZeroHash
                )
            ).to.be.revertedWith("Pausable: fn paused");

            // depositRequest should still work
            await expect(
                depositVault.connect(user).depositRequest(
                    await mockUSDC.getAddress(), ethers.parseUnits("1000", 6), ethers.ZeroHash
                )
            ).to.emit(depositVault, "DepositRequest");
        });
    });

    describe("#67 — Pause redemptions → all redeem txs revert", function () {
        it("Contract-level pause blocks all redemption operations", async function () {
            await redemptionVault.connect(owner).pause();

            await expect(
                redemptionVault.connect(user).redeemInstant(
                    await mockUSDC.getAddress(), ethers.parseUnits("500", 18), 0
                )
            ).to.be.revertedWith("Pausable: paused");

            await expect(
                redemptionVault.connect(user).redeemRequest(
                    await mockUSDC.getAddress(), ethers.parseUnits("500", 18)
                )
            ).to.be.revertedWith("Pausable: paused");
        });
    });

    describe("#68 — Unpause → operations resume normally", function () {
        it("Unpausing DepositVault allows deposits to resume", async function () {
            await depositVault.connect(owner).pause();

            // Verify paused
            await expect(
                depositVault.connect(user).depositInstant(
                    await mockUSDC.getAddress(), ethers.parseUnits("1000", 6), 0, ethers.ZeroHash
                )
            ).to.be.revertedWith("Pausable: paused");

            // Unpause
            await depositVault.connect(owner).unpause();

            // Operations resume
            await expect(
                depositVault.connect(user).depositInstant(
                    await mockUSDC.getAddress(), ethers.parseUnits("1000", 6), 0, ethers.ZeroHash
                )
            ).to.emit(depositVault, "DepositInstant");
        });

        it("Unpausing RedemptionVault allows redemptions to resume", async function () {
            await redemptionVault.connect(owner).pause();
            await redemptionVault.connect(owner).unpause();

            await expect(
                redemptionVault.connect(user).redeemInstant(
                    await mockUSDC.getAddress(), ethers.parseUnits("500", 18), 0
                )
            ).to.emit(redemptionVault, "RedeemInstant");
        });
    });

    describe("#69 — Pause → pending request-based flows frozen", function () {
        it("Creating new deposit requests is blocked when vault is paused", async function () {
            // Create one request before pause
            await depositVault.connect(user).depositRequest(
                await mockUSDC.getAddress(), ethers.parseUnits("500", 6), ethers.ZeroHash
            );

            // Pause the vault
            await depositVault.connect(owner).pause();

            // New deposit requests are blocked
            await expect(
                depositVault.connect(user).depositRequest(
                    await mockUSDC.getAddress(), ethers.parseUnits("500", 6), ethers.ZeroHash
                )
            ).to.be.revertedWith("Pausable: paused");

            // Admin can still approve the pre-existing request (approveRequest has no pause guard)
            await expect(
                depositVault.connect(owner).approveRequest(0, ethers.parseUnits("1", 18))
            ).to.not.be.reverted;
        });

        it("Creating new redeem requests is blocked when RedemptionVault is paused", async function () {
            await redemptionVault.connect(owner).pause();

            await expect(
                redemptionVault.connect(user).redeemRequest(
                    await mockUSDC.getAddress(), ethers.parseUnits("500", 18)
                )
            ).to.be.revertedWith("Pausable: paused");
        });
    });
});
