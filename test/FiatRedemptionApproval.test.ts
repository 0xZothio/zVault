import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import type {
    RedemptionVault,
    ZOPAL
} from "../typechain-types";

/**
 * Test suite for Fiat Redemption Approval behavior
 * 
 * Issue: Fiat redemption approval reverts due to allowance check on zero address
 * 
 * When a user creates a fiat redemption request (redeemFiatRequest), the tokenOut
 * is set to MANUAL_FULLFILMENT_TOKEN (address(0)). When the admin tries to approve
 * this request, _requireAndUpdateAllowance is called with address(0), which fails
 * because no allowance has been set for the zero address.
 */
describe("Fiat Redemption Approval", function () {
    let mockUSDC: any;
    let redemptionVault: RedemptionVault;
    let zToken: ZOPAL;

    let owner: SignerWithAddress;
    let user: SignerWithAddress;
    let requestRedeemer: SignerWithAddress;

    const MANUAL_FULLFILMENT_TOKEN = ethers.ZeroAddress;

    async function deployFiatRedemptionFixture() {
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

        // Deploy mock USDC
        const MockTokenFactory = await ethers.getContractFactory("MockERC20");
        const mockUSDC = await MockTokenFactory.deploy("USD Coin", "USDC", 6);

        // Deploy FunctionsAccessControl for PriceOracle
        const FunctionsAccessControlFactory = await ethers.getContractFactory("FunctionsAccessControl");
        const functionsAccessControl = await FunctionsAccessControlFactory.deploy(
            await deployer.getAddress()
        );

        // Deploy PriceOracle for zToken
        const PriceOracleFactory = await ethers.getContractFactory("PriceOracle");
        const priceOracle = await PriceOracleFactory.deploy(
            await functionsAccessControl.getAddress(),
            8,
            500,
            86400
        );

        // Deploy stablecoin oracle
        const stablecoinOracle = await PriceOracleFactory.deploy(
            await functionsAccessControl.getAddress(),
            8,
            500,
            86400
        );

        // Grant price admin role and set prices
        await functionsAccessControl.grantPriceAdminRole(await deployer.getAddress());
        await priceOracle.setPrice(ethers.parseUnits("1", 8));
        await stablecoinOracle.setPrice(ethers.parseUnits("1", 8));

        // Deploy zOPAL token
        const zOPALFactory = await ethers.getContractFactory("zOPAL");
        const zTokenImpl = await zOPALFactory.deploy();
        const zTokenInitData = zTokenImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            ethers.ZeroAddress
        ]);
        const zTokenProxy = await ERC1967ProxyFactory.deploy(
            await zTokenImpl.getAddress(),
            zTokenInitData
        );
        const zToken = zOPALFactory.attach(await zTokenProxy.getAddress()) as unknown as ZOPAL;

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
            ethers.ZeroAddress, // sanctions list
            100, // variation tolerance
            ethers.parseUnits("1", 18), // min amount
            {
                minFiatRedeemAmount: ethers.parseUnits("100", 18),
                fiatAdditionalFee: 50, // 0.5%
                fiatFlatFee: ethers.parseUnits("10", 18)
            },
            await requestRedeemerAccount.getAddress()
        ]);
        const redemptionVaultProxy = await ERC1967ProxyFactory.deploy(
            await redemptionVaultImpl.getAddress(),
            redemptionVaultInitData
        );
        const redemptionVault = RedemptionVaultFactory.attach(
            await redemptionVaultProxy.getAddress()
        ) as unknown as RedemptionVault;

        // Grant roles
        const REDEMPTION_VAULT_ADMIN_ROLE = await accessControl.REDEMPTION_VAULT_ADMIN_ROLE();
        const ZOPAL_BURN_OPERATOR_ROLE = await accessControl.ZOPAL_BURN_OPERATOR_ROLE();
        const ZOPAL_MINT_OPERATOR_ROLE = await accessControl.ZOPAL_MINT_OPERATOR_ROLE();
        const GREENLISTED_ROLE = await accessControl.GREENLISTED_ROLE();

        await accessControl.grantRole(REDEMPTION_VAULT_ADMIN_ROLE, await deployer.getAddress());
        await accessControl.grantRole(ZOPAL_BURN_OPERATOR_ROLE, await redemptionVault.getAddress());
        await accessControl.grantRole(ZOPAL_MINT_OPERATOR_ROLE, await deployer.getAddress());
        await accessControl.grantRole(GREENLISTED_ROLE, await userAccount.getAddress());

        // Add USDC as payment token to redemption vault
        await redemptionVault.addPaymentToken(
            await mockUSDC.getAddress(),
            await stablecoinOracle.getAddress(),
            100,
            true
        );

        // Mint zTokens to user for redemption tests
        const userZTokenAmount = ethers.parseUnits("10000", 18);
        await zToken.mint(await userAccount.getAddress(), userZTokenAmount);

        // Approve redemption vault to spend user's zTokens
        await zToken.connect(userAccount).approve(
            await redemptionVault.getAddress(),
            ethers.MaxUint256
        );

        return {
            mockUSDC,
            redemptionVault,
            zToken,
            accessControl,
            priceOracle,
            stablecoinOracle,
            deployer,
            userAccount,
            tokensReceiverAccount,
            feeReceiverAccount,
            requestRedeemerAccount
        };
    }

    beforeEach(async function () {
        const fixture = await loadFixture(deployFiatRedemptionFixture);
        mockUSDC = fixture.mockUSDC;
        redemptionVault = fixture.redemptionVault;
        zToken = fixture.zToken;
        owner = fixture.deployer;
        user = fixture.userAccount;
        requestRedeemer = fixture.requestRedeemerAccount;
    });

    describe("Fiat Redemption Request Creation", function () {
        it("Should create a fiat redemption request with tokenOut = address(0)", async function () {
            const redeemAmount = ethers.parseUnits("500", 18);

            const tx = await redemptionVault.connect(user).redeemFiatRequest(redeemAmount);
            const receipt = await tx.wait();

            // Check request was created
            const request = await redemptionVault.redeemRequests(0);
            expect(request.sender).to.equal(await user.getAddress());
            expect(request.tokenOut).to.equal(MANUAL_FULLFILMENT_TOKEN);
            expect(request.status).to.equal(0); // Pending
        });

        it("Should transfer zTokens to vault on fiat request creation", async function () {
            const redeemAmount = ethers.parseUnits("500", 18);
            const userBalanceBefore = await zToken.balanceOf(await user.getAddress());

            await redemptionVault.connect(user).redeemFiatRequest(redeemAmount);

            const userBalanceAfter = await zToken.balanceOf(await user.getAddress());
            expect(userBalanceBefore - userBalanceAfter).to.equal(redeemAmount);
        });
    });

    describe("Fiat Redemption Approval - Allowance Issue", function () {
        let requestId: bigint;

        beforeEach(async function () {
            // Create a fiat redemption request
            const redeemAmount = ethers.parseUnits("500", 18);
            await redemptionVault.connect(user).redeemFiatRequest(redeemAmount);
            requestId = 0n;
        });

        it("Should revert when approving fiat request without address(0) allowance", async function () {
            const newZTokenRate = ethers.parseUnits("1", 18);

            // This should fail because no allowance is set for address(0)
            await expect(
                redemptionVault.connect(owner).approveRequest(requestId, newZTokenRate)
            ).to.be.revertedWith("MV: exceed allowance");
        });

        it("Should revert safeApproveRequest without address(0) allowance", async function () {
            const newZTokenRate = ethers.parseUnits("1", 18);

            await expect(
                redemptionVault.connect(owner).safeApproveRequest(requestId, newZTokenRate)
            ).to.be.revertedWith("MV: exceed allowance");
        });

        it("Should succeed after setting allowance for address(0) - workaround", async function () {
            const newZTokenRate = ethers.parseUnits("1", 18);

            // Workaround: Set allowance for MANUAL_FULLFILMENT_TOKEN (address(0))
            await redemptionVault.connect(owner).changeTokenAllowance(
                MANUAL_FULLFILMENT_TOKEN,
                ethers.MaxUint256
            );

            // Now approval should succeed
            await expect(
                redemptionVault.connect(owner).approveRequest(requestId, newZTokenRate)
            ).to.emit(redemptionVault, "ApproveRequest");

            // Verify request is now processed
            const request = await redemptionVault.redeemRequests(requestId);
            expect(request.status).to.equal(1); // Processed
        });

        it("Should burn zTokens on successful fiat approval", async function () {
            const newZTokenRate = ethers.parseUnits("1", 18);

            // Set allowance workaround
            await redemptionVault.connect(owner).changeTokenAllowance(
                MANUAL_FULLFILMENT_TOKEN,
                ethers.MaxUint256
            );

            const vaultBalanceBefore = await zToken.balanceOf(await redemptionVault.getAddress());

            await redemptionVault.connect(owner).approveRequest(requestId, newZTokenRate);

            const vaultBalanceAfter = await zToken.balanceOf(await redemptionVault.getAddress());
            
            // zTokens should be burned
            expect(vaultBalanceAfter).to.be.lessThan(vaultBalanceBefore);
        });
    });

    describe("Token-based vs Fiat Redemption Comparison", function () {
        it("Token redemption request should not have address(0) issue", async function () {
            const redeemAmount = ethers.parseUnits("500", 18);

            // Create token redemption request (not fiat)
            await redemptionVault.connect(user).redeemRequest(
                await mockUSDC.getAddress(),
                redeemAmount
            );

            const request = await redemptionVault.redeemRequests(0);
            expect(request.tokenOut).to.not.equal(MANUAL_FULLFILMENT_TOKEN);
            expect(request.tokenOut).to.equal(await mockUSDC.getAddress());
        });

        it("Token redemption approval should work if token allowance is set", async function () {
            const redeemAmount = ethers.parseUnits("500", 18);
            const newZTokenRate = ethers.parseUnits("1", 18);

            // Create token redemption request
            await redemptionVault.connect(user).redeemRequest(
                await mockUSDC.getAddress(),
                redeemAmount
            );

            // Set token allowance
            await redemptionVault.connect(owner).changeTokenAllowance(
                await mockUSDC.getAddress(),
                ethers.MaxUint256
            );

            // Fund the request redeemer with USDC
            await mockUSDC.mint(await requestRedeemer.getAddress(), ethers.parseUnits("1000", 6));
            await mockUSDC.connect(requestRedeemer).approve(
                await redemptionVault.getAddress(),
                ethers.MaxUint256
            );

            // Approval should work for token-based redemption
            await expect(
                redemptionVault.connect(owner).approveRequest(0, newZTokenRate)
            ).to.emit(redemptionVault, "ApproveRequest");
        });
    });

    describe("Reject Fiat Request - Should Work Without Allowance", function () {
        it("Should allow rejecting fiat request without allowance issue", async function () {
            const redeemAmount = ethers.parseUnits("500", 18);

            // Create fiat request
            await redemptionVault.connect(user).redeemFiatRequest(redeemAmount);

            // Reject should work without any allowance setup
            await expect(
                redemptionVault.connect(owner).rejectRequest(0)
            ).to.emit(redemptionVault, "RejectRequest");

            // Request should be canceled
            const request = await redemptionVault.redeemRequests(0);
            expect(request.status).to.equal(2); // Canceled
        });

        it("Should NOT return zTokens to user on rejection (tokens stay in vault)", async function () {
            const redeemAmount = ethers.parseUnits("500", 18);
            const userBalanceBefore = await zToken.balanceOf(await user.getAddress());

            // Create fiat request
            await redemptionVault.connect(user).redeemFiatRequest(redeemAmount);
            
            const userBalanceAfterRequest = await zToken.balanceOf(await user.getAddress());
            expect(userBalanceAfterRequest).to.equal(userBalanceBefore - redeemAmount);

            const vaultBalanceBeforeReject = await zToken.balanceOf(await redemptionVault.getAddress());

            // Reject request - note: this only marks status, doesn't return tokens
            await redemptionVault.connect(owner).rejectRequest(0);

            const userBalanceAfterReject = await zToken.balanceOf(await user.getAddress());
            const vaultBalanceAfterReject = await zToken.balanceOf(await redemptionVault.getAddress());
            
            // User balance unchanged after rejection - tokens remain in vault
            expect(userBalanceAfterReject).to.equal(userBalanceAfterRequest);
            // Vault still holds the tokens
            expect(vaultBalanceAfterReject).to.equal(vaultBalanceBeforeReject);
        });
    });

    describe("Edge Cases", function () {
        it("Should handle minimum fiat redemption amount", async function () {
            // minFiatRedeemAmount is set to 100 in fixture
            const belowMinAmount = ethers.parseUnits("50", 18);

            await expect(
                redemptionVault.connect(user).redeemFiatRequest(belowMinAmount)
            ).to.be.revertedWith("RV: amount < min");
        });

        it("Should apply fiat flat fee on redemption", async function () {
            const redeemAmount = ethers.parseUnits("500", 18);

            // Create fiat request and check that fees are applied
            await redemptionVault.connect(user).redeemFiatRequest(redeemAmount);

            const request = await redemptionVault.redeemRequests(0);
            // The amountZToken stored should be less than input due to fees
            expect(request.amountZToken).to.be.lessThan(redeemAmount);
        });

        it("Multiple fiat requests should all fail approval without allowance", async function () {
            const redeemAmount = ethers.parseUnits("200", 18);
            const newZTokenRate = ethers.parseUnits("1", 18);

            // Create multiple fiat requests
            await redemptionVault.connect(user).redeemFiatRequest(redeemAmount);
            await redemptionVault.connect(user).redeemFiatRequest(redeemAmount);
            await redemptionVault.connect(user).redeemFiatRequest(redeemAmount);

            // All should fail
            await expect(
                redemptionVault.connect(owner).approveRequest(0, newZTokenRate)
            ).to.be.revertedWith("MV: exceed allowance");

            await expect(
                redemptionVault.connect(owner).approveRequest(1, newZTokenRate)
            ).to.be.revertedWith("MV: exceed allowance");

            await expect(
                redemptionVault.connect(owner).approveRequest(2, newZTokenRate)
            ).to.be.revertedWith("MV: exceed allowance");
        });

        it("Setting limited allowance for address(0) should track usage", async function () {
            const newZTokenRate = ethers.parseUnits("1", 18);

            // Create multiple fiat requests
            await redemptionVault.connect(user).redeemFiatRequest(ethers.parseUnits("200", 18));
            await redemptionVault.connect(user).redeemFiatRequest(ethers.parseUnits("200", 18));

            // Set limited allowance (just enough for one request)
            await redemptionVault.connect(owner).changeTokenAllowance(
                MANUAL_FULLFILMENT_TOKEN,
                ethers.parseUnits("200", 18)
            );

            // First approval should succeed
            await expect(
                redemptionVault.connect(owner).approveRequest(0, newZTokenRate)
            ).to.emit(redemptionVault, "ApproveRequest");

            // Second should fail due to insufficient allowance
            await expect(
                redemptionVault.connect(owner).approveRequest(1, newZTokenRate)
            ).to.be.revertedWith("MV: exceed allowance");
        });
    });
});
