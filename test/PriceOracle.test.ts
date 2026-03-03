import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { PriceOracle } from "../typechain-types/contracts";
import type { FunctionsAccessControl } from "../typechain-types/contracts/access";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("PriceOracle", function () {
    let priceOracle: PriceOracle;
    let accessControl: FunctionsAccessControl;
    let owner: SignerWithAddress;
    let priceAdmin: SignerWithAddress;
    let configAdmin: SignerWithAddress;
    let unauthorizedUser: SignerWithAddress;

    // Deploy fixtures
    async function deployPriceOracleFixture() {
        const [deployer, priceAdminAccount, configAdminAccount, user] =
            await ethers.getSigners();

        // Deploy access control
        const AccessControlFactory = await ethers.getContractFactory(
            "FunctionsAccessControl"
        );
        const accessControl = await AccessControlFactory.deploy(
            await deployer.getAddress()
        );

        // Deploy PriceOracle
        const PriceOracleFactory = await ethers.getContractFactory("PriceOracle");
        const priceOracle = await PriceOracleFactory.deploy(
            await accessControl.getAddress(),
            8, // 8 decimals for price input
            500, // 5% tolerance (500 basis points)
            86400 // 24 hours max staleness
        );

        // Grant roles
        await accessControl.grantPriceAdminRole(await priceAdminAccount.getAddress());
        await accessControl.grantConfigRole(await configAdminAccount.getAddress());

        return {
            priceOracle,
            accessControl,
            deployer,
            priceAdminAccount,
            configAdminAccount,
            user,
        };
    }

    beforeEach(async function () {
        const fixture = await loadFixture(deployPriceOracleFixture);
        priceOracle = fixture.priceOracle;
        accessControl = fixture.accessControl;
        owner = fixture.deployer;
        priceAdmin = fixture.priceAdminAccount;
        configAdmin = fixture.configAdminAccount;
        unauthorizedUser = fixture.user;
    });

    describe("Deployment", function () {
        it("Should deploy with correct initial parameters", async function () {
            expect(await priceOracle.priceDecimals()).to.equal(8);
            expect(await priceOracle.tolerancePercent()).to.equal(500);
            expect(await priceOracle.currentPrice()).to.equal(0);
            expect(await priceOracle.lastUpdateTimestamp()).to.equal(0);
        });

        it("Should revert if decimals exceed 18", async function () {
            const PriceOracleFactory = await ethers.getContractFactory("PriceOracle");
            await expect(
                PriceOracleFactory.deploy(await accessControl.getAddress(), 19, 500, 86400)
            ).to.be.revertedWith("Decimals too high");
        });

        it("Should revert if tolerance exceeds 100%", async function () {
            const PriceOracleFactory = await ethers.getContractFactory("PriceOracle");
            await expect(
                PriceOracleFactory.deploy(
                    await accessControl.getAddress(),
                    8,
                    10001,
                    86400
                )
            ).to.be.revertedWith("Tolerance cannot exceed 100%");
        });

        it("Should accept tolerance at exactly 100%", async function () {
            const PriceOracleFactory = await ethers.getContractFactory("PriceOracle");
            const oracle = await PriceOracleFactory.deploy(
                await accessControl.getAddress(),
                8,
                10000,
                86400
            );
            expect(await oracle.tolerancePercent()).to.equal(10000);
        });
    });

    describe("Price Updates", function () {
        it("Should set initial price successfully", async function () {
            const price = ethers.parseUnits("100", 8); // 100 with 8 decimals
            await expect(priceOracle.connect(priceAdmin).setPrice(price))
                .to.emit(priceOracle, "PriceUpdated")

            expect(await priceOracle.currentPrice()).to.equal(
                ethers.parseUnits("100", 18)
            );
            expect(await priceOracle.lastUpdateTimestamp()).to.be.greaterThan(0);
        });

        it("Should revert when setting price to zero", async function () {
            await expect(
                priceOracle.connect(priceAdmin).setPrice(0)
            ).to.be.revertedWithCustomError(priceOracle, "InvalidPrice");
        });

        it("Should revert when unauthorized user tries to set price", async function () {
            const price = ethers.parseUnits("100", 8);
            await expect(
                priceOracle.connect(unauthorizedUser).setPrice(price)
            ).to.be.revertedWithCustomError(priceOracle, "UnauthorizedAccess");
        });

        it("Should allow price update within tolerance (increase)", async function () {
            const initialPrice = ethers.parseUnits("100", 8);
            await priceOracle.connect(priceAdmin).setPrice(initialPrice);

            // Increase by 4% (within 5% tolerance)
            const newPrice = ethers.parseUnits("104", 8);
            await expect(
                priceOracle.connect(priceAdmin).setPrice(newPrice)
            ).to.emit(priceOracle, "PriceUpdated");

            expect(await priceOracle.currentPrice()).to.equal(
                ethers.parseUnits("104", 18)
            );
        });

        it("Should allow price update within tolerance (decrease)", async function () {
            const initialPrice = ethers.parseUnits("100", 8);
            await priceOracle.connect(priceAdmin).setPrice(initialPrice);

            // Decrease by 4% (within 5% tolerance)
            const newPrice = ethers.parseUnits("96", 8);
            await expect(
                priceOracle.connect(priceAdmin).setPrice(newPrice)
            ).to.emit(priceOracle, "PriceUpdated");

            expect(await priceOracle.currentPrice()).to.equal(
                ethers.parseUnits("96", 18)
            );
        });

        it("Should allow price update at exactly tolerance limit", async function () {
            const initialPrice = ethers.parseUnits("100", 8);
            await priceOracle.connect(priceAdmin).setPrice(initialPrice);

            // Exactly 5% increase
            const newPrice = ethers.parseUnits("105", 8);
            await expect(
                priceOracle.connect(priceAdmin).setPrice(newPrice)
            ).to.emit(priceOracle, "PriceUpdated");

            expect(await priceOracle.currentPrice()).to.equal(
                ethers.parseUnits("105", 18)
            );
        });

        it("Should revert when price exceeds tolerance (increase)", async function () {
            const initialPrice = ethers.parseUnits("100", 8);
            await priceOracle.connect(priceAdmin).setPrice(initialPrice);

            // Increase by 6% (exceeds 5% tolerance)
            const newPrice = ethers.parseUnits("106", 8);
            await expect(
                priceOracle.connect(priceAdmin).setPrice(newPrice)
            ).to.be.revertedWithCustomError(priceOracle, "ToleranceExceeded");
        });

        it("Should revert when price exceeds tolerance (decrease)", async function () {
            const initialPrice = ethers.parseUnits("100", 8);
            await priceOracle.connect(priceAdmin).setPrice(initialPrice);

            // Decrease by 6% (exceeds 5% tolerance)
            const newPrice = ethers.parseUnits("94", 8);
            await expect(
                priceOracle.connect(priceAdmin).setPrice(newPrice)
            ).to.be.revertedWithCustomError(priceOracle, "ToleranceExceeded");
        });

        it("Should allow price update when tolerance is zero", async function () {
            // Set tolerance to zero
            await priceOracle.connect(configAdmin).setTolerancePercent(0);

            const initialPrice = ethers.parseUnits("100", 8);
            await priceOracle.connect(priceAdmin).setPrice(initialPrice);

            // Any change should be allowed when tolerance is 0
            const newPrice = ethers.parseUnits("200", 8);
            await expect(
                priceOracle.connect(priceAdmin).setPrice(newPrice)
            ).to.emit(priceOracle, "PriceUpdated");

            expect(await priceOracle.currentPrice()).to.equal(
                ethers.parseUnits("200", 18)
            );
        });

        it("Should allow first price update without tolerance check", async function () {
            const price = ethers.parseUnits("1000", 8);
            await expect(
                priceOracle.connect(priceAdmin).setPrice(price)
            ).to.emit(priceOracle, "PriceUpdated");

            expect(await priceOracle.currentPrice()).to.equal(
                ethers.parseUnits("1000", 18)
            );
        });
    });

    describe("Decimal Conversion", function () {
        it("Should correctly convert 8 decimal price to base18", async function () {
            const price8Decimals = ethers.parseUnits("100", 8);
            await priceOracle.connect(priceAdmin).setPrice(price8Decimals);

            const priceBase18 = await priceOracle.getDataInBase18();
            expect(priceBase18).to.equal(ethers.parseUnits("100", 18));
        });

        it("Should correctly convert 6 decimal price to base18", async function () {
            // Change decimals to 6
            await priceOracle.connect(configAdmin).setPriceDecimals(6);

            const price6Decimals = ethers.parseUnits("100", 6);
            await priceOracle.connect(priceAdmin).setPrice(price6Decimals);

            const priceBase18 = await priceOracle.getDataInBase18();
            expect(priceBase18).to.equal(ethers.parseUnits("100", 18));
        });

        it("Should correctly convert 18 decimal price to base18", async function () {
            // Change decimals to 18
            await priceOracle.connect(configAdmin).setPriceDecimals(18);

            const price18Decimals = ethers.parseUnits("100", 18);
            await priceOracle.connect(priceAdmin).setPrice(price18Decimals);

            const priceBase18 = await priceOracle.getDataInBase18();
            expect(priceBase18).to.equal(ethers.parseUnits("100", 18));
        });

        it("Should correctly return price in specified decimals via getPrice", async function () {
            const price8Decimals = ethers.parseUnits("100", 8);
            await priceOracle.connect(priceAdmin).setPrice(price8Decimals);

            // Get price in 6 decimals
            const price6Decimals = await priceOracle.getPrice(6);
            expect(price6Decimals).to.equal(ethers.parseUnits("100", 6));

            // Get price in 8 decimals
            const price8DecimalsResult = await priceOracle.getPrice(8);
            expect(price8DecimalsResult).to.equal(ethers.parseUnits("100", 8));

            // Get price in 18 decimals
            const price18DecimalsResult = await priceOracle.getPrice(18);
            expect(price18DecimalsResult).to.equal(ethers.parseUnits("100", 18));
        });

        it("Should revert getPrice when decimals exceed 18", async function () {
            await expect(priceOracle.getPrice(19)).to.be.revertedWithCustomError(
                priceOracle,
                "InvalidDecimals"
            );
        });
    });

    describe("Tolerance Configuration", function () {
        it("Should update tolerance successfully", async function () {
            const newTolerance = 1000; // 10%
            await expect(
                priceOracle.connect(configAdmin).setTolerancePercent(newTolerance)
            )
                .to.emit(priceOracle, "ToleranceUpdated")
                .withArgs(500, newTolerance);

            expect(await priceOracle.tolerancePercent()).to.equal(newTolerance);
        });

        it("Should revert when setting tolerance above 100%", async function () {
            await expect(
                priceOracle.connect(configAdmin).setTolerancePercent(10001)
            ).to.be.revertedWith("Tolerance cannot exceed 100%");
        });

        it("Should allow tolerance at exactly 100%", async function () {
            await expect(
                priceOracle.connect(configAdmin).setTolerancePercent(10000)
            ).to.emit(priceOracle, "ToleranceUpdated");

            expect(await priceOracle.tolerancePercent()).to.equal(10000);
        });

        it("Should revert when unauthorized user tries to set tolerance", async function () {
            await expect(
                priceOracle.connect(unauthorizedUser).setTolerancePercent(1000)
            ).to.be.revertedWithCustomError(priceOracle, "UnauthorizedAccess");
        });

        it("Should use new tolerance for subsequent price updates", async function () {
            const initialPrice = ethers.parseUnits("100", 8);
            await priceOracle.connect(priceAdmin).setPrice(initialPrice);

            // Increase tolerance to 10%
            await priceOracle.connect(configAdmin).setTolerancePercent(1000);

            // Now 8% increase should be allowed
            const newPrice = ethers.parseUnits("108", 8);
            await expect(
                priceOracle.connect(priceAdmin).setPrice(newPrice)
            ).to.emit(priceOracle, "PriceUpdated");
        });
    });

    describe("Price Decimals Configuration", function () {
        it("Should update price decimals successfully", async function () {
            const newDecimals = 6;
            await expect(
                priceOracle.connect(configAdmin).setPriceDecimals(newDecimals)
            )
                .to.emit(priceOracle, "PriceDecimalsUpdated")
                .withArgs(8, newDecimals);

            expect(await priceOracle.priceDecimals()).to.equal(newDecimals);
        });

        it("Should revert when setting decimals above 18", async function () {
            await expect(
                priceOracle.connect(configAdmin).setPriceDecimals(19)
            ).to.be.revertedWithCustomError(priceOracle, "InvalidDecimals");
        });

        it("Should allow decimals at exactly 18", async function () {
            await expect(
                priceOracle.connect(configAdmin).setPriceDecimals(18)
            ).to.emit(priceOracle, "PriceDecimalsUpdated");

            expect(await priceOracle.priceDecimals()).to.equal(18);
        });

        it("Should revert when unauthorized user tries to set decimals", async function () {
            await expect(
                priceOracle.connect(unauthorizedUser).setPriceDecimals(6)
            ).to.be.revertedWithCustomError(priceOracle, "UnauthorizedAccess");
        });

        it("Should use new decimals for subsequent price updates", async function () {
            // Change decimals to 6
            await priceOracle.connect(configAdmin).setPriceDecimals(6);

            // Set price with 6 decimals
            const price6Decimals = ethers.parseUnits("100", 6);
            await priceOracle.connect(priceAdmin).setPrice(price6Decimals);

            expect(await priceOracle.currentPrice()).to.equal(
                ethers.parseUnits("100", 18)
            );
        });
    });

    describe("Price Age and Staleness", function () {
        it("Should return zero age when price has never been set", async function () {
            expect(await priceOracle.getPriceAge()).to.equal(0);
        });

        it("Should return correct price age", async function () {
            const price = ethers.parseUnits("100", 8);
            await priceOracle.connect(priceAdmin).setPrice(price);

            // Advance time by 1 hour
            await time.increase(3600);

            const age = await priceOracle.getPriceAge();
            expect(age).to.equal(3600);
        });

        it("Should return false when price is not stale", async function () {
            const price = ethers.parseUnits("100", 8);
            await priceOracle.connect(priceAdmin).setPrice(price);

            // Check if stale with maxAge of 1 day
            const isStale = await priceOracle.isPriceStale(86400);
            expect(isStale).to.be.false;
        });

        it("Should return true when price is stale", async function () {
            const price = ethers.parseUnits("100", 8);
            await priceOracle.connect(priceAdmin).setPrice(price);

            // Advance time by 2 days
            await time.increase(172800);

            // Check if stale with maxAge of 1 day
            const isStale = await priceOracle.isPriceStale(86400);
            expect(isStale).to.be.true;
        });

        it("Should return true when price has never been set", async function () {
            const isStale = await priceOracle.isPriceStale(86400);
            expect(isStale).to.be.true;
        });

        it("Should return false when price age equals maxAge", async function () {
            const price = ethers.parseUnits("100", 8);
            await priceOracle.connect(priceAdmin).setPrice(price);

            // Advance time by exactly 1 day
            await time.increase(86400);

            // Check if stale with maxAge of 1 day
            const isStale = await priceOracle.isPriceStale(86400);
            expect(isStale).to.be.false;
        });
    });

    describe("Edge Cases", function () {
        it("Should handle very small price values correctly", async function () {
            const smallPrice = 1; // 1 wei equivalent in 8 decimals
            await priceOracle.connect(priceAdmin).setPrice(smallPrice);

            expect(await priceOracle.currentPrice()).to.equal(
                ethers.parseUnits("0.00000001", 18)
            );
        });

        it("Should handle very large price values correctly", async function () {
            const largePrice = ethers.parseUnits("1000000", 8);
            await priceOracle.connect(priceAdmin).setPrice(largePrice);

            expect(await priceOracle.currentPrice()).to.equal(
                ethers.parseUnits("1000000", 18)
            );
        });

        it("Should handle price conversion from higher decimals to lower", async function () {
            // Set price decimals to 18
            await priceOracle.connect(configAdmin).setPriceDecimals(18);

            const price18 = ethers.parseUnits("100", 18);
            await priceOracle.connect(priceAdmin).setPrice(price18);

            // Get price in 8 decimals
            const price8 = await priceOracle.getPrice(8);
            expect(price8).to.equal(ethers.parseUnits("100", 8));
        });

        it("Should handle multiple price updates correctly", async function () {
            const price1 = ethers.parseUnits("100", 8);
            await priceOracle.connect(priceAdmin).setPrice(price1);

            await time.increase(3600);

            const price2 = ethers.parseUnits("102", 8);
            await priceOracle.connect(priceAdmin).setPrice(price2);

            await time.increase(3600);

            const price3 = ethers.parseUnits("104", 8);
            await priceOracle.connect(priceAdmin).setPrice(price3);

            expect(await priceOracle.currentPrice()).to.equal(
                ethers.parseUnits("104", 18)
            );
            await time.increase(3600);

            expect(await priceOracle.getPriceAge()).to.be.greaterThan(0);
        });

        it("Should handle zero conversion correctly", async function () {
            // When currentPrice is 0, getPrice should return 0 for any decimals
            expect(await priceOracle.getPrice(8)).to.equal(0);
            expect(await priceOracle.getPrice(6)).to.equal(0);
            expect(await priceOracle.getPrice(18)).to.equal(0);
        });
    });

    describe("Tolerance Calculation", function () {
        it("Should calculate tolerance correctly for small price changes", async function () {
            const initialPrice = ethers.parseUnits("100", 8);
            await priceOracle.connect(priceAdmin).setPrice(initialPrice);

            // 0.5% change should pass (tolerance is 5%)
            const newPrice = ethers.parseUnits("100.5", 8);
            await expect(
                priceOracle.connect(priceAdmin).setPrice(newPrice)
            ).to.emit(priceOracle, "PriceUpdated");
        });

        it("Should calculate tolerance correctly for large deviations", async function () {
            const initialPrice = ethers.parseUnits("1", 8);
            await priceOracle.connect(priceAdmin).setPrice(initialPrice);

            // 6% increase should fail
            const newPrice = ethers.parseUnits("1.06", 8);
            await expect(
                priceOracle.connect(priceAdmin).setPrice(newPrice)
            ).to.be.revertedWithCustomError(priceOracle, "ToleranceExceeded");
        });

        it("Should handle tolerance with different decimal inputs", async function () {
            // Change decimals to 6
            await priceOracle.connect(configAdmin).setPriceDecimals(6);

            const initialPrice = ethers.parseUnits("100", 6);
            await priceOracle.connect(priceAdmin).setPrice(initialPrice);

            // 4% increase should pass
            const newPrice = ethers.parseUnits("104", 6);
            await expect(
                priceOracle.connect(priceAdmin).setPrice(newPrice)
            ).to.emit(priceOracle, "PriceUpdated");
        });
    });
});

