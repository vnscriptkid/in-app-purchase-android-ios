var assert = require("assert");
var fsPromises = require("fs/promises");
var fixedPath = process.cwd() + "/test/receipts/apple_no_products";

const IAP_APPLE_SECRET = "8a85a3d388964ab9a0eef9cafa0d3e9b";

describe("bug test", () => {
    it("ignore expired", async () => {
        var iap = require("..");

        iap.config({ verbose: true });

        await iap.setup();

        let receipt = await fsPromises.readFile(fixedPath, {
            encoding: "utf-8",
        });

        const response = await iap.validateOnce(receipt, IAP_APPLE_SECRET);

        assert.equal(iap.isValidated(response), true);

        var data = iap.getPurchaseData(response, { ignoreExpired: true });

        expect(data).toHaveLength(0);
    });

    it("does not ignore expired", async () => {
        var iap = require("..");

        iap.config({ verbose: true });

        await iap.setup();

        let receipt = await fsPromises.readFile(fixedPath, {
            encoding: "utf-8",
        });

        const response = await iap.validateOnce(receipt, IAP_APPLE_SECRET);

        assert.equal(iap.isValidated(response), true);

        var data = iap.getPurchaseData(response /*{ ignoreExpired: true }*/);

        expect(data).toHaveLength(1);

        for (var i = 0, len = data.length; i < len; i++) {
            console.log("parsedPurchaseData:", i, data);
            assert(data[i].productId);
            assert(data[i].purchaseDate);
            assert(data[i].quantity);
        }
    });
});
