import { errorMap, REC_KEYS } from "./constants";
const async = require("../async");
const verbose = require("../verbose");
const constants = require("../../constants");
const responseData = require("../responseData");
let request = require("request");

let config: any = null;

const sandboxHost = "sandbox.itunes.apple.com";
const liveHost = "buy.itunes.apple.com";
const path = "/verifyReceipt";
let testMode = false;

function isExpired(responseData: any) {
  if (
    responseData[REC_KEYS.LRI] &&
    responseData[REC_KEYS.LRI][REC_KEYS.EXPIRES_DATE]
  ) {
    var exp = parseInt(responseData[REC_KEYS.LRI][REC_KEYS.EXPIRES_DATE]);
    if (exp > Date.now()) {
      return true;
    }
    return false;
  }
  // old receipt
}

function isValidConfigKey(key: any) {
  return key.match(/^apple/);
}

export const readConfig = function (configIn: any) {
  if (!configIn) {
    // no apple iap or password not required
    return;
  }

  // set up verbose logging
  verbose.setup(configIn);
  // we do NOT use liveHost if true
  testMode = configIn.test || false;
  verbose.log("<Apple> test mode?", testMode);

  config = {};
  var configValueSet = false;
  // Apply any default settings to Request.
  if ("requestDefaults" in configIn) {
    request = request.defaults(configIn.requestDefaults);
  }
  Object.keys(configIn).forEach(function (key) {
    if (isValidConfigKey(key)) {
      config[key] = configIn[key];
      configValueSet = true;
    }
  });

  if (!configValueSet) {
    config = null;
  }
};

export const setup = function (cb: Function) {
  if (!config || !config.applePassword) {
    if (process.env.APPLE_IAP_PASSWORD) {
      config = config || {};
      config.applePassword = process.env.APPLE_IAP_PASSWORD;
    }
  }

  return cb();
};

export const validatePurchase = function (
  secret: any,
  receipt: any,
  cb: Function
) {
  const prodPath = "https://" + liveHost + path;
  const sandboxPath = "https://" + sandboxHost + path;

  let status;
  let validatedData: any;
  let isValid = false;
  const content: any = { "receipt-data": receipt };

  if (config && config.applePassword) {
    content.password = config.applePassword;
  }

  if (config && config.appleExcludeOldTransactions) {
    content["exclude-old-transactions"] = config.appleExcludeOldTransactions;
  }

  // override applePassword from config to allow dynamically fed secret to validate
  if (secret) {
    verbose.log("<Apple> Using dynamic applePassword:", secret);
    content.password = secret;
  }

  verbose.log("<Apple> Validatation data:", content);

  var tryProd = function (next: Function) {
    if (testMode) {
      verbose.log("<Apple> test mode: skip production validation");
      return next();
    }
    verbose.log("<Apple> Try validate against production:", prodPath);
    send(prodPath, content, function (error: any, res: any, data: any) {
      verbose.log("<Apple>", prodPath, "validation response:", data);
      // request error
      if (error) {
        // 1 is unknown
        status = data ? data.status : 1;
        validatedData = {
          sandbox: false,
          status: status,
          message: (errorMap as any)[status] || "Unknown",
        };
        applyResponseData(validatedData, data);
        verbose.log("<Apple>", prodPath, "failed:", error, validatedData);
        error.validatedData = validatedData;
        return next(error);
      }
      // apple responded with error
      if (data.status > 0 && data.status !== 21007 && data.status !== 21002) {
        if (data.status === 21006 && !isExpired(data)) {
          /* valid subscription receipt,
                    but cancelled and it has not been expired
                    status code is 21006 for both expired receipt and cancelled receipt...
                    */
          validatedData = data;
          validatedData.sandbox = false;
          // force status to be 0
          validatedData.status = 0;
          verbose.log(
            "<Apple> Valid receipt, but has been cancelled (not expired yet)"
          );
          isValid = true;
          return next();
        }
        verbose.log("<Apple>", prodPath, "failed:", data);
        status = data.status;
        var emsg = (errorMap as any)[status] || "Unknown";
        var err = new Error(emsg);
        validatedData = {
          sandbox: false,
          status: status,
          message: emsg,
        };
        applyResponseData(validatedData, data);
        verbose.log("<Apple>", prodPath, "failed:", validatedData);
        (err as any).validatedData = validatedData;
        return next(err);
      }
      // try sandbox...
      if (data.status === 21007 || data.status === 21002) {
        return next();
      }
      // production validated
      validatedData = data;
      validatedData.sandbox = false;
      verbose.log("<Apple> Production validation successful:", validatedData);
      isValid = true;
      next();
    });
  };

  var trySandbox = function (next: Function) {
    if (isValid) {
      return next();
    }
    verbose.log("<Apple> Try validate against sandbox:", sandboxPath);
    send(sandboxPath, content, function (error: any, res: any, data: any) {
      verbose.log("<Apple>", sandboxPath, "validation response:", data);
      if (error) {
        // 1 is unknown
        status = data ? data.status : 1;
        validatedData = {
          sandbox: true,
          status: status,
          message: (errorMap as any)[status] || "Unknown",
        };
        applyResponseData(validatedData, data);
        verbose.log("<Apple>", sandboxPath, "failed:", error, validatedData);
        error.validatedData = validatedData;
        return next(error);
      }
      if (data.status > 0 && data.status !== 21002) {
        if (data.status === 21006 && !isExpired(data)) {
          /* valid subscription receipt,
                    but cancelled and it has not been expired
                    status code is 21006 for both expired receipt and cancelled receipt...
                    */
          validatedData = data;
          validatedData.sandbox = true;
          // force status to be 0
          validatedData.status = 0;
          verbose.log(
            "<Apple> Valid receipt, but has been cancelled (not expired yet)"
          );
          isValid = true;
          return next();
        }
        verbose.log("<Apple>", sandboxPath, "failed:", data);
        status = data.status;
        var emsg = (errorMap as any)[status] || "Unknown";
        var err = new Error(emsg);
        validatedData = {
          sandbox: true,
          status: status,
          message: emsg,
        };
        applyResponseData(validatedData, data);
        verbose.log("<Apple>", sandboxPath, "failed:", validatedData);
        (err as any).validatedData = validatedData;
        return next(err);
      }
      // sandbox validated
      validatedData = data;
      validatedData.sandbox = true;
      verbose.log("<Apple> Sandbox validation successful:", validatedData);
      next();
    });
  };

  var done = function (error: any) {
    if (error) {
      return cb(error, validatedData);
    }
    handleResponse(receipt, validatedData, cb);
  };

  var tasks = [tryProd, trySandbox];
  async.series(tasks, done);
};

export const getPurchaseData = function (purchase: any, options: any) {
  if (!purchase || !purchase.receipt) {
    return null;
  }
  var data = [];
  if (purchase.receipt[REC_KEYS.IN_APP]) {
    // iOS 6+
    var now = Date.now();
    var tids = [];
    var list = purchase.receipt[REC_KEYS.IN_APP];
    var lri = purchase[REC_KEYS.LRI] || purchase.receipt[REC_KEYS.LRI];
    if (lri && Array.isArray(lri)) {
      list = list.concat(lri);
    }
    /*
        we sort list by purchase_date_ms to make it easier
        to weed out duplicates (items with the same original_transaction_id)
        purchase_date_ms DESC
        */
    list.sort(function (a: any, b: any) {
      return (
        parseInt(b[REC_KEYS.PURCHASE_DATE_MS], 10) -
        parseInt(a[REC_KEYS.PURCHASE_DATE_MS], 10)
      );
    });
    for (var i = 0, len = list.length; i < len; i++) {
      var item = list[i];
      var tid = item["original_" + REC_KEYS.TRANSACTION_ID];
      var exp = getSubscriptionExpireDate(item);

      if (
        options &&
        options.ignoreCanceled &&
        item[REC_KEYS.CANCELLATION_DATE] &&
        item[REC_KEYS.CANCELLATION_DATE].length &&
        /* if a subscription has been cancelled,
                we need to check if the receipt has expired or not...
                if it is not subscription (exp is 0 in that case), we ignore right away...
                */
        (!exp || now - exp >= 0)
      ) {
        continue;
      }

      if (options && options.ignoreExpired && exp && now - exp >= 0) {
        // we are told to ignore expired item and it is expired
        continue;
      }
      if (tids.indexOf(tid) > -1) {
        /* avoid duplicate and keep the latest
                there are cases where we could have
                the same "time" so we evaludate <= instead of < alone */
        continue;
      }

      tids.push(tid);
      var parsed = responseData.parse(item);
      // transaction ID should be a string:
      // https://developer.apple.com/documentation/storekit/skpaymenttransaction/1411288-transactionidentifier
      parsed.transactionId = parsed.transactionId.toString();

      // originalTransactionId should also be a string
      if (
        parsed.originalTransactionId &&
        !isNaN(parsed.originalTransactionId)
      ) {
        parsed.originalTransactionId = parsed.originalTransactionId.toString();
      }

      // we need to stick to the name isTrial
      if (parsed.isTrialPeriod !== undefined) {
        parsed.isTrial = bool(parsed.isTrialPeriod);
      } else {
        parsed.isTrial = false;
      }

      parsed.bundleId =
        purchase.receipt[REC_KEYS.BUNDLE_ID] || purchase.receipt[REC_KEYS.BID];
      parsed.expirationDate = exp;
      data.push(parsed);
    }
    return data;
  }
  // old and will be deprecated by Apple
  var receipt = purchase[REC_KEYS.LRI] || purchase.receipt;
  data.push({
    bundleId: receipt[REC_KEYS.BUNDLE_ID] || receipt[REC_KEYS.BID],
    appItemId: receipt[REC_KEYS.ITEM_ID],
    originalTransactionId: receipt[REC_KEYS.ORIGINAL_TRANSACTION_ID],
    transactionId: receipt[REC_KEYS.TRANSACTION_ID],
    productId: receipt[REC_KEYS.PRODUCT_ID],
    originalPurchaseDate: receipt[REC_KEYS.ORIGINAL_PURCHASE_DATE_MS],
    purchaseDate: receipt[REC_KEYS.PURCHASE_DATE_MS],
    quantity: parseInt(receipt.quantity, 10),
    expirationDate: getSubscriptionExpireDate(receipt),
    isTrial: bool(receipt[REC_KEYS.IS_TRIAL]),
    cancellationDate: receipt[REC_KEYS.CANCELLATION_DATE] || 0,
  });
  return data;
};

function bool(val: any) {
  return val === "true" ? true : false;
}

function getSubscriptionExpireDate(data: any) {
  if (!data) {
    return 0;
  }
  if (data[REC_KEYS.EXPIRES_DATE_MS]) {
    return parseInt(data[REC_KEYS.EXPIRES_DATE_MS], 10);
  }
  if (data[REC_KEYS.EXPIRES_DATE]) {
    return data[REC_KEYS.EXPIRES_DATE];
  }
  if (data[REC_KEYS.EXPIRATION_DATE]) {
    return data[REC_KEYS.EXPIRATION_DATE];
  }
  if (data[REC_KEYS.EXPIRATION_INTENT]) {
    return parseInt(data[REC_KEYS.EXPIRATION_INTENT], 10);
  }
  return 0;
}

function handleResponse(receipt: any, data: any, cb: any) {
  data.service = constants.SERVICES.APPLE;
  if (data.status === constants.VALIDATION.SUCCESS) {
    if (
      data.receipt[REC_KEYS.IN_APP] &&
      !data.receipt[REC_KEYS.IN_APP].length
    ) {
      // receipt is valid, but the receipt bought nothing
      // probably hacked: https://forums.developer.apple.com/thread/8954
      // https://developer.apple.com/library/mac/technotes/tn2413/_index.html#//apple_ref/doc/uid/DTS40016228-CH1-RECEIPT-HOW_DO_I_USE_THE_CANCELLATION_DATE_FIELD_
      data.status = constants.VALIDATION.POSSIBLE_HACK;
      data.message = (errorMap as any)[data.status];
      verbose.log(
        "<Apple>",
        "Empty purchased detected: in_app array is empty:",
        "consider invalid and does not validate",
        data
      );
      return cb(new Error("failed to validate for empty purchased list"), data);
    }
    // validated successfully
    return cb(null, data);
  } else {
    // error -> add error message
    data.message = (errorMap as any)[data.status] || "Unkown";
  }

  // failed to validate
  cb(new Error("failed to validate purchase"), data);
}

function send(url: string, content: any, cb: any) {
  var options = {
    encoding: null,
    url: url,
    body: content,
    json: true,
  };
  request.post(options, function (error: any, res: any, body: any) {
    return cb(error, res, body);
  });
}

function applyResponseData(target: any, source: any) {
  for (var key in source) {
    if (target[key] === undefined) {
      target[key] = source[key];
    }
  }
}
