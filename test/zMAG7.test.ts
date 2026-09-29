import { expect } from "chai";
import { ethers } from "hardhat";
import { impersonateAccount, loadFixture, setBalance, time } from "@nomicfoundation/hardhat-network-helpers";

describe("zMAG7", function () {
    const MIN_DELAY = 86400;

    async function deployMag7Fixture() {
        const [
            deployer,
            userAccount,
            unauthorizedAccount,
            tokensReceiverAccount,
            feeReceiverAccount,
            requestRedeemerAccount,
            proposer,
            executor,
        ] = await ethers.getSigners();

        const AccessControlFactory = await ethers.getContractFactory("ZothAccessControl");
        const accessControlImpl = await AccessControlFactory.deploy();
        const accessControlInit = accessControlImpl.interface.encodeFunctionData("initialize", []);

        const ERC1967ProxyFactory = await ethers.getContractFactory(
            "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"
        );
        const accessControlProxy = await ERC1967ProxyFactory.deploy(
            await accessControlImpl.getAddress(),
            accessControlInit
        );
        const accessControl = AccessControlFactory.attach(await accessControlProxy.getAddress()) as any;

        const ProxyAdminFactory = await ethers.getContractFactory(
            "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol:ProxyAdmin"
        );
        const proxyAdmin = await ProxyAdminFactory.deploy();

        const TransparentProxyFactory = await ethers.getContractFactory(
            "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy"
        );

        const MockTokenFactory = await ethers.getContractFactory("MockERC20");
        const mockUSDC = await MockTokenFactory.deploy("USD Coin", "USDC", 6);

        const FunctionsAccessControlFactory = await ethers.getContractFactory("FunctionsAccessControl");
        const mag7FunctionsAccessControl = await FunctionsAccessControlFactory.deploy(await deployer.getAddress());
        const opalFunctionsAccessControl = await FunctionsAccessControlFactory.deploy(await deployer.getAddress());

        const PriceOracleFactory = await ethers.getContractFactory("PriceOracle");
        const mag7Oracle = await PriceOracleFactory.deploy(
            await mag7FunctionsAccessControl.getAddress(),
            8,
            10000,
            86400 * 365
        );
        const opalOracle = await PriceOracleFactory.deploy(
            await opalFunctionsAccessControl.getAddress(),
            8,
            10000,
            86400 * 365
        );
        const stablecoinOracle = await PriceOracleFactory.deploy(
            await mag7FunctionsAccessControl.getAddress(),
            8,
            500,
            86400 * 365
        );

        await mag7FunctionsAccessControl.grantPriceAdminRole(await deployer.getAddress());
        await opalFunctionsAccessControl.grantPriceAdminRole(await deployer.getAddress());
        await mag7Oracle.setPrice(ethers.parseUnits("1", 8));
        await opalOracle.setPrice(ethers.parseUnits("1", 8));
        await stablecoinOracle.setPrice(ethers.parseUnits("1", 8));

        const zOPALFactory = await ethers.getContractFactory("zOPAL");
        const zOPALImpl = await zOPALFactory.deploy();
        const zOPALInit = zOPALImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            ethers.ZeroAddress,
        ]);
        const zOPALProxy = await TransparentProxyFactory.deploy(
            await zOPALImpl.getAddress(),
            await proxyAdmin.getAddress(),
            zOPALInit
        );
        const zOPAL = zOPALFactory.attach(await zOPALProxy.getAddress()) as any;

        const zMAG7Factory = await ethers.getContractFactory("zMAG7");
        const zMAG7Impl = await zMAG7Factory.deploy();
        const zMAG7Init = zMAG7Impl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            ethers.ZeroAddress,
        ]);
        const zMAG7Proxy = await TransparentProxyFactory.deploy(
            await zMAG7Impl.getAddress(),
            await proxyAdmin.getAddress(),
            zMAG7Init
        );
        const zMAG7 = zMAG7Factory.attach(await zMAG7Proxy.getAddress()) as any;

        const DepositVaultFactory = await ethers.getContractFactory("zMAG7DepositVault");
        const depositVaultImpl = await DepositVaultFactory.deploy();
        const depositVaultInit = depositVaultImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            { zToken: await zMAG7.getAddress(), zTokenDataFeed: await mag7Oracle.getAddress() },
            {
                tokensReceiver: await tokensReceiverAccount.getAddress(),
                feeReceiver: await feeReceiverAccount.getAddress(),
            },
            { instantFee: 0, instantDailyLimit: ethers.parseUnits("1000000", 18) },
            ethers.ZeroAddress,
            10000,
            ethers.parseUnits("1", 18),
            0,
            ethers.parseUnits("10000000", 18),
        ]);
        const depositVaultProxy = await TransparentProxyFactory.deploy(
            await depositVaultImpl.getAddress(),
            await proxyAdmin.getAddress(),
            depositVaultInit
        );
        const depositVault = DepositVaultFactory.attach(await depositVaultProxy.getAddress()) as any;

        const RedemptionVaultFactory = await ethers.getContractFactory("zMAG7RedemptionVault");
        const redemptionVaultImpl = await RedemptionVaultFactory.deploy();
        const redemptionVaultInit = redemptionVaultImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            { zToken: await zMAG7.getAddress(), zTokenDataFeed: await mag7Oracle.getAddress() },
            {
                tokensReceiver: await tokensReceiverAccount.getAddress(),
                feeReceiver: await feeReceiverAccount.getAddress(),
            },
            { instantFee: 50, instantDailyLimit: ethers.parseUnits("1000000", 18) },
            ethers.ZeroAddress,
            10000,
            ethers.parseUnits("1", 18),
            {
                minFiatRedeemAmount: ethers.parseUnits("1", 18),
                fiatAdditionalFee: 0,
                fiatFlatFee: 0,
            },
            await requestRedeemerAccount.getAddress(),
        ]);
        const redemptionVaultProxy = await TransparentProxyFactory.deploy(
            await redemptionVaultImpl.getAddress(),
            await proxyAdmin.getAddress(),
            redemptionVaultInit
        );
        const redemptionVault = RedemptionVaultFactory.attach(await redemptionVaultProxy.getAddress()) as any;

        const MAG7_DEPOSIT_VAULT_ADMIN_ROLE = await depositVault.MAG7_DEPOSIT_VAULT_ADMIN_ROLE();
        const MAG7_REDEMPTION_VAULT_ADMIN_ROLE = await redemptionVault.MAG7_REDEMPTION_VAULT_ADMIN_ROLE();
        const MAG7_MINT_OPERATOR_ROLE = await zMAG7.MAG7_MINT_OPERATOR_ROLE();
        const MAG7_BURN_OPERATOR_ROLE = await zMAG7.MAG7_BURN_OPERATOR_ROLE();
        const ZOPAL_MINT_OPERATOR_ROLE = await accessControl.ZOPAL_MINT_OPERATOR_ROLE();
        const ZOPAL_BURN_OPERATOR_ROLE = await accessControl.ZOPAL_BURN_OPERATOR_ROLE();

        const MAG7_PAUSE_OPERATOR_ROLE = await zMAG7.MAG7_PAUSE_OPERATOR_ROLE();
        const ZOPAL_PAUSE_OPERATOR_ROLE = await accessControl.ZOPAL_PAUSE_OPERATOR_ROLE();
        const ZOPAL_DEPOSIT_VAULT_ADMIN_ROLE = ethers.keccak256(
            ethers.toUtf8Bytes("ZOPAL_DEPOSIT_VAULT_ADMIN_ROLE")
        );

        const OpalDepositVaultFactory = await ethers.getContractFactory("zOPALDepositVault");
        const opalDepositVaultImpl = await OpalDepositVaultFactory.deploy();
        const opalDepositVaultInit = opalDepositVaultImpl.interface.encodeFunctionData("initialize", [
            await accessControl.getAddress(),
            { zToken: await zOPAL.getAddress(), zTokenDataFeed: await opalOracle.getAddress() },
            {
                tokensReceiver: await tokensReceiverAccount.getAddress(),
                feeReceiver: await feeReceiverAccount.getAddress(),
            },
            { instantFee: 0, instantDailyLimit: ethers.parseUnits("1000000", 18) },
            ethers.ZeroAddress,
            10000,
            ethers.parseUnits("1", 18),
            0,
            ethers.parseUnits("10000000", 18),
        ]);
        const opalDepositVaultProxy = await TransparentProxyFactory.deploy(
            await opalDepositVaultImpl.getAddress(),
            await proxyAdmin.getAddress(),
            opalDepositVaultInit
        );
        const opalDepositVault = OpalDepositVaultFactory.attach(
            await opalDepositVaultProxy.getAddress()
        ) as any;

        await accessControl.grantRole(MAG7_DEPOSIT_VAULT_ADMIN_ROLE, await deployer.getAddress());
        await accessControl.grantRole(MAG7_REDEMPTION_VAULT_ADMIN_ROLE, await deployer.getAddress());
        await accessControl.grantRole(ZOPAL_DEPOSIT_VAULT_ADMIN_ROLE, await deployer.getAddress());
        await accessControl.grantRole(MAG7_MINT_OPERATOR_ROLE, await depositVault.getAddress());
        await accessControl.grantRole(MAG7_BURN_OPERATOR_ROLE, await redemptionVault.getAddress());
        await accessControl.grantRole(ZOPAL_MINT_OPERATOR_ROLE, await opalDepositVault.getAddress());
        await accessControl.grantRole(MAG7_MINT_OPERATOR_ROLE, await deployer.getAddress());
        await accessControl.grantRole(ZOPAL_MINT_OPERATOR_ROLE, await deployer.getAddress());
        await accessControl.grantRole(ZOPAL_BURN_OPERATOR_ROLE, await deployer.getAddress());

        await depositVault.addPaymentToken(
            await mockUSDC.getAddress(),
            await stablecoinOracle.getAddress(),
            0,
            ethers.parseUnits("1000000", 18),
            true
        );
        await redemptionVault.addPaymentToken(
            await mockUSDC.getAddress(),
            await stablecoinOracle.getAddress(),
            10,
            true
        );
        await redemptionVault.changeTokenAllowance(await mockUSDC.getAddress(), ethers.MaxUint256);

        const usdcAmount = ethers.parseUnits("100000", 6);
        await mockUSDC.mint(await userAccount.getAddress(), usdcAmount);
        await mockUSDC.connect(userAccount).approve(await depositVault.getAddress(), usdcAmount);
        await mockUSDC.mint(await redemptionVault.getAddress(), usdcAmount);

        const TimelockFactory = await ethers.getContractFactory("UpgradeTimelock");
        const timelock = await TimelockFactory.deploy(
            MIN_DELAY,
            [await proposer.getAddress()],
            [await executor.getAddress()],
            await deployer.getAddress()
        );
        const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
        await timelock.grantRole(CANCELLER_ROLE, await executor.getAddress());
        await timelock.revokeRole(CANCELLER_ROLE, await proposer.getAddress());
        await proxyAdmin.transferOwnership(await timelock.getAddress());

        return {
            accessControl,
            proxyAdmin,
            timelock,
            zOPAL,
            zOPALProxy,
            zMAG7,
            zMAG7Proxy,
            zMAG7Factory,
            depositVault,
            depositVaultProxy,
            redemptionVault,
            mag7Oracle,
            opalOracle,
            mockUSDC,
            MAG7_MINT_OPERATOR_ROLE,
            MAG7_BURN_OPERATOR_ROLE,
            MAG7_PAUSE_OPERATOR_ROLE,
            MAG7_DEPOSIT_VAULT_ADMIN_ROLE,
            ZOPAL_MINT_OPERATOR_ROLE,
            ZOPAL_BURN_OPERATOR_ROLE,
            ZOPAL_PAUSE_OPERATOR_ROLE,
            ZOPAL_DEPOSIT_VAULT_ADMIN_ROLE,
            opalDepositVault,
            deployer,
            userAccount,
            unauthorizedAccount,
            requestRedeemerAccount,
            proposer,
            executor,
        };
    }

    describe("token and roles", function () {
        it("deploys zMAG7 with a distinct name and symbol", async function () {
            const { zMAG7 } = await loadFixture(deployMag7Fixture);
            expect(await zMAG7.name()).to.equal("zMAG7");
            expect(await zMAG7.symbol()).to.equal("zMAG7");
        });

        it("MAG7 and zOPAL mint/burn/pause role hashes are different", async function () {
            const { zMAG7, accessControl } = await loadFixture(deployMag7Fixture);

            expect(await zMAG7.MAG7_MINT_OPERATOR_ROLE()).to.equal(
                ethers.keccak256(ethers.toUtf8Bytes("MAG7_MINT_OPERATOR_ROLE"))
            );
            expect(await accessControl.ZOPAL_MINT_OPERATOR_ROLE()).to.equal(
                ethers.keccak256(ethers.toUtf8Bytes("ZOPAL_MINT_OPERATOR_ROLE"))
            );

            // zMAG7 inherits both constant sets; mint/burn/pause still use MAG7_*.
            expect(await zMAG7.MAG7_MINT_OPERATOR_ROLE()).to.not.equal(
                await zMAG7.ZOPAL_MINT_OPERATOR_ROLE()
            );
            expect(await zMAG7.MAG7_BURN_OPERATOR_ROLE()).to.not.equal(
                await zMAG7.ZOPAL_BURN_OPERATOR_ROLE()
            );
            expect(await zMAG7.MAG7_PAUSE_OPERATOR_ROLE()).to.not.equal(
                await zMAG7.ZOPAL_PAUSE_OPERATOR_ROLE()
            );
        });

        it("MAG7 mint operator can mint zMAG7 but not zOPAL", async function () {
            const { zMAG7, zOPAL, accessControl, MAG7_MINT_OPERATOR_ROLE, unauthorizedAccount } =
                await loadFixture(deployMag7Fixture);
            await accessControl.grantRole(MAG7_MINT_OPERATOR_ROLE, await unauthorizedAccount.getAddress());

            await expect(
                zMAG7.connect(unauthorizedAccount).mint(await unauthorizedAccount.getAddress(), 1)
            ).to.not.be.reverted;
            await expect(
                zOPAL.connect(unauthorizedAccount).mint(await unauthorizedAccount.getAddress(), 1)
            ).to.be.revertedWith("WZAC: hasnt role");
        });

        it("zOPAL mint operator can mint zOPAL but not zMAG7", async function () {
            const { zMAG7, zOPAL, accessControl, ZOPAL_MINT_OPERATOR_ROLE, unauthorizedAccount } =
                await loadFixture(deployMag7Fixture);
            await accessControl.grantRole(ZOPAL_MINT_OPERATOR_ROLE, await unauthorizedAccount.getAddress());

            await expect(
                zOPAL.connect(unauthorizedAccount).mint(await unauthorizedAccount.getAddress(), 1)
            ).to.not.be.reverted;
            await expect(
                zMAG7.connect(unauthorizedAccount).mint(await unauthorizedAccount.getAddress(), 1)
            ).to.be.revertedWith("WZAC: hasnt role");
        });

        it("MAG7 burn operator can burn zMAG7 but not zOPAL", async function () {
            const { zMAG7, zOPAL, accessControl, MAG7_BURN_OPERATOR_ROLE, unauthorizedAccount } =
                await loadFixture(deployMag7Fixture);

            await zMAG7.mint(await unauthorizedAccount.getAddress(), 10);
            await zOPAL.mint(await unauthorizedAccount.getAddress(), 10);
            await accessControl.grantRole(MAG7_BURN_OPERATOR_ROLE, await unauthorizedAccount.getAddress());

            await expect(
                zMAG7.connect(unauthorizedAccount).burn(await unauthorizedAccount.getAddress(), 1)
            ).to.not.be.reverted;
            await expect(
                zOPAL.connect(unauthorizedAccount).burn(await unauthorizedAccount.getAddress(), 1)
            ).to.be.revertedWith("WZAC: hasnt role");
        });

        it("zOPAL burn operator can burn zOPAL but not zMAG7", async function () {
            const { zMAG7, zOPAL, accessControl, ZOPAL_BURN_OPERATOR_ROLE, unauthorizedAccount } =
                await loadFixture(deployMag7Fixture);

            await zMAG7.mint(await unauthorizedAccount.getAddress(), 10);
            await zOPAL.mint(await unauthorizedAccount.getAddress(), 10);
            await accessControl.grantRole(ZOPAL_BURN_OPERATOR_ROLE, await unauthorizedAccount.getAddress());

            await expect(
                zOPAL.connect(unauthorizedAccount).burn(await unauthorizedAccount.getAddress(), 1)
            ).to.not.be.reverted;
            await expect(
                zMAG7.connect(unauthorizedAccount).burn(await unauthorizedAccount.getAddress(), 1)
            ).to.be.revertedWith("WZAC: hasnt role");
        });

        it("MAG7 pause operator can pause zMAG7 but not zOPAL", async function () {
            const { zMAG7, zOPAL, accessControl, MAG7_PAUSE_OPERATOR_ROLE, unauthorizedAccount } =
                await loadFixture(deployMag7Fixture);
            await accessControl.grantRole(MAG7_PAUSE_OPERATOR_ROLE, await unauthorizedAccount.getAddress());

            await expect(zMAG7.connect(unauthorizedAccount).pause()).to.not.be.reverted;
            await expect(zOPAL.connect(unauthorizedAccount).pause()).to.be.revertedWith("WZAC: hasnt role");
        });

        it("zOPAL pause operator can pause zOPAL but not zMAG7", async function () {
            const { zMAG7, zOPAL, accessControl, ZOPAL_PAUSE_OPERATOR_ROLE, unauthorizedAccount } =
                await loadFixture(deployMag7Fixture);
            await accessControl.grantRole(ZOPAL_PAUSE_OPERATOR_ROLE, await unauthorizedAccount.getAddress());

            await expect(zOPAL.connect(unauthorizedAccount).pause()).to.not.be.reverted;
            await expect(zMAG7.connect(unauthorizedAccount).pause()).to.be.revertedWith("WZAC: hasnt role");
        });

        it("MAG7 deposit vault cannot mint zOPAL, and zOPAL deposit vault cannot mint zMAG7", async function () {
            const { zMAG7, zOPAL, depositVault, opalDepositVault, unauthorizedAccount } =
                await loadFixture(deployMag7Fixture);

            await impersonateAccount(await depositVault.getAddress());
            await setBalance(await depositVault.getAddress(), ethers.parseEther("1"));
            const mag7VaultSigner = await ethers.getSigner(await depositVault.getAddress());

            await expect(
                zOPAL.connect(mag7VaultSigner).mint(await unauthorizedAccount.getAddress(), 1)
            ).to.be.revertedWith("WZAC: hasnt role");

            await impersonateAccount(await opalDepositVault.getAddress());
            await setBalance(await opalDepositVault.getAddress(), ethers.parseEther("1"));
            const opalVaultSigner = await ethers.getSigner(await opalDepositVault.getAddress());

            await expect(
                zMAG7.connect(opalVaultSigner).mint(await unauthorizedAccount.getAddress(), 1)
            ).to.be.revertedWith("WZAC: hasnt role");
        });

        it("zOPAL deposit vault admin cannot administer the MAG7 deposit vault", async function () {
            const {
                depositVault, accessControl, mockUSDC, mag7Oracle,
                ZOPAL_DEPOSIT_VAULT_ADMIN_ROLE, unauthorizedAccount,
            } = await loadFixture(deployMag7Fixture);

            await accessControl.grantRole(
                ZOPAL_DEPOSIT_VAULT_ADMIN_ROLE,
                await unauthorizedAccount.getAddress()
            );

            await expect(
                depositVault.connect(unauthorizedAccount).addPaymentToken(
                    await mockUSDC.getAddress(),
                    await mag7Oracle.getAddress(),
                    0,
                    ethers.MaxUint256,
                    true
                )
            ).to.be.revertedWith("WZAC: hasnt role");
        });

        it("MAG7 deposit vault admin cannot administer the zOPAL deposit vault", async function () {
            const {
                opalDepositVault, accessControl, mockUSDC, opalOracle,
                MAG7_DEPOSIT_VAULT_ADMIN_ROLE, unauthorizedAccount,
            } = await loadFixture(deployMag7Fixture);

            await accessControl.grantRole(
                MAG7_DEPOSIT_VAULT_ADMIN_ROLE,
                await unauthorizedAccount.getAddress()
            );

            await expect(
                opalDepositVault.connect(unauthorizedAccount).addPaymentToken(
                    await mockUSDC.getAddress(),
                    await opalOracle.getAddress(),
                    0,
                    ethers.MaxUint256,
                    true
                )
            ).to.be.revertedWith("WZAC: hasnt role");
        });
    });

    describe("deposit and redemption", function () {
        it("instant deposit mints zMAG7 to the user", async function () {
            const { depositVault, zMAG7, mockUSDC, userAccount } = await loadFixture(deployMag7Fixture);
            const amount = ethers.parseUnits("1000", 6);
            const before = await zMAG7.balanceOf(await userAccount.getAddress());

            await expect(
                depositVault.connect(userAccount).depositInstant(
                    await mockUSDC.getAddress(),
                    amount,
                    0,
                    ethers.ZeroHash
                )
            ).to.emit(depositVault, "DepositInstant");

            expect(await zMAG7.balanceOf(await userAccount.getAddress())).to.be.greaterThan(before);
        });

        it("after pausing depositInstant, depositRequest still works", async function () {
            const { depositVault, mockUSDC, userAccount, deployer } = await loadFixture(deployMag7Fixture);
            const instant = depositVault.interface.getFunction(
                "depositInstant(address,uint256,uint256,bytes32)"
            ).selector;
            const instantRecipient = depositVault.interface.getFunction(
                "depositInstant(address,uint256,uint256,bytes32,address)"
            ).selector;
            await depositVault.connect(deployer).pauseFn(instant);
            await depositVault.connect(deployer).pauseFn(instantRecipient);

            await expect(
                depositVault.connect(userAccount).depositInstant(
                    await mockUSDC.getAddress(),
                    ethers.parseUnits("1000", 6),
                    0,
                    ethers.ZeroHash
                )
            ).to.be.revertedWith("Pausable: fn paused");

            await expect(
                depositVault.connect(userAccount).depositRequest(
                    await mockUSDC.getAddress(),
                    ethers.parseUnits("1000", 6),
                    ethers.ZeroHash
                )
            ).to.emit(depositVault, "DepositRequest");
        });

        it("deposit request can be approved by MAG7 vault admin", async function () {
            const { depositVault, zMAG7, mockUSDC, userAccount, deployer } = await loadFixture(deployMag7Fixture);
            await depositVault.connect(userAccount).depositRequest(
                await mockUSDC.getAddress(),
                ethers.parseUnits("1000", 6),
                ethers.ZeroHash
            );

            const before = await zMAG7.balanceOf(await userAccount.getAddress());
            await expect(
                depositVault.connect(deployer).approveRequest(0, ethers.parseUnits("1", 18))
            ).to.emit(depositVault, "ApproveRequest");
            expect(await zMAG7.balanceOf(await userAccount.getAddress())).to.be.greaterThan(before);
        });

        it("non-MAG7 admin cannot approve a deposit request", async function () {
            const { depositVault, mockUSDC, userAccount, unauthorizedAccount } =
                await loadFixture(deployMag7Fixture);
            await depositVault.connect(userAccount).depositRequest(
                await mockUSDC.getAddress(),
                ethers.parseUnits("1000", 6),
                ethers.ZeroHash
            );
            await expect(
                depositVault.connect(unauthorizedAccount).approveRequest(0, ethers.parseUnits("1", 18))
            ).to.be.revertedWith("WZAC: hasnt role");
        });

        it("redeem request can be approved by MAG7 redemption admin", async function () {
            const { depositVault, redemptionVault, zMAG7, mockUSDC, userAccount, deployer, requestRedeemerAccount } =
                await loadFixture(deployMag7Fixture);

            await depositVault.connect(userAccount).depositInstant(
                await mockUSDC.getAddress(),
                ethers.parseUnits("2000", 6),
                0,
                ethers.ZeroHash
            );
            await zMAG7.connect(userAccount).approve(await redemptionVault.getAddress(), ethers.MaxUint256);

            await redemptionVault.connect(userAccount).redeemRequest(
                await mockUSDC.getAddress(),
                ethers.parseUnits("1000", 18)
            );

            await mockUSDC.mint(await requestRedeemerAccount.getAddress(), ethers.parseUnits("10000", 6));
            await mockUSDC.connect(requestRedeemerAccount).approve(
                await redemptionVault.getAddress(),
                ethers.MaxUint256
            );

            const supplyBefore = await zMAG7.totalSupply();
            await expect(
                redemptionVault.connect(deployer).approveRequest(0, ethers.parseUnits("1", 18))
            ).to.emit(redemptionVault, "ApproveRequest");
            expect(await zMAG7.totalSupply()).to.be.lessThan(supplyBefore);
        });
    });

    describe("shared ProxyAdmin and UpgradeTimelock", function () {
        it("zMAG7 and zOPAL proxies share the same ProxyAdmin", async function () {
            const { proxyAdmin, zMAG7Proxy, zOPALProxy, depositVaultProxy } = await loadFixture(deployMag7Fixture);
            const adminAddress = await proxyAdmin.getAddress();
            expect(await proxyAdmin.getProxyAdmin(await zMAG7Proxy.getAddress())).to.equal(adminAddress);
            expect(await proxyAdmin.getProxyAdmin(await zOPALProxy.getAddress())).to.equal(adminAddress);
            expect(await proxyAdmin.getProxyAdmin(await depositVaultProxy.getAddress())).to.equal(adminAddress);
        });

        it("ProxyAdmin is owned by UpgradeTimelock", async function () {
            const { proxyAdmin, timelock } = await loadFixture(deployMag7Fixture);
            expect(await proxyAdmin.owner()).to.equal(await timelock.getAddress());
        });

        it("direct ProxyAdmin upgrade of zMAG7 reverts after timelock transfer", async function () {
            const { proxyAdmin, zMAG7Proxy, zMAG7Factory, deployer } = await loadFixture(deployMag7Fixture);
            const newImpl = await zMAG7Factory.deploy();
            await expect(
                proxyAdmin.connect(deployer).upgrade(await zMAG7Proxy.getAddress(), await newImpl.getAddress())
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("zMAG7 upgrade succeeds through the shared timelock", async function () {
            const { proxyAdmin, timelock, zMAG7, zMAG7Proxy, zMAG7Factory, proposer, executor, userAccount, deployer, MAG7_MINT_OPERATOR_ROLE, accessControl } =
                await loadFixture(deployMag7Fixture);

            await accessControl.grantRole(MAG7_MINT_OPERATOR_ROLE, await deployer.getAddress());
            await zMAG7.mint(await userAccount.getAddress(), ethers.parseUnits("100", 18));
            const balanceBefore = await zMAG7.balanceOf(await userAccount.getAddress());

            const newImpl = await zMAG7Factory.deploy();
            const upgradeData = proxyAdmin.interface.encodeFunctionData("upgrade", [
                await zMAG7Proxy.getAddress(),
                await newImpl.getAddress(),
            ]);
            const salt = ethers.id("mag7-upgrade-test");
            const predecessor = ethers.ZeroHash;

            await timelock.connect(proposer).schedule(
                await proxyAdmin.getAddress(),
                0,
                upgradeData,
                predecessor,
                salt,
                MIN_DELAY
            );
            await time.increase(MIN_DELAY);
            await timelock.connect(executor).execute(
                await proxyAdmin.getAddress(),
                0,
                upgradeData,
                predecessor,
                salt
            );

            expect(await proxyAdmin.getProxyImplementation(await zMAG7Proxy.getAddress())).to.equal(
                await newImpl.getAddress()
            );
            expect(await zMAG7.name()).to.equal("zMAG7");
            expect(await zMAG7.balanceOf(await userAccount.getAddress())).to.equal(balanceBefore);
        });

        it("MAG7 price oracle is not upgradeable", async function () {
            const { mag7Oracle } = await loadFixture(deployMag7Fixture);
            expect((mag7Oracle as any).upgradeTo).to.equal(undefined);
            expect((mag7Oracle as any).upgradeToAndCall).to.equal(undefined);
        });

        it("MAG7 oracle is independent of the zOPAL oracle", async function () {
            const { mag7Oracle, opalOracle } = await loadFixture(deployMag7Fixture);
            await mag7Oracle.setPrice(ethers.parseUnits("1.05", 8));
            expect(await mag7Oracle.currentPrice()).to.not.equal(await opalOracle.currentPrice());
        });
    });
});
