import * as constants from "./constants";

const async = require("./lib/async");
const apple = require("./lib/apple/index");
const google = require("./lib/google/index");
const verbose = require("./lib/verbose");

function handlePromisedFunctionCb(resolve: any, reject: any) {
  return function _handlePromisedCallback(error: any, response: any) {
    if (error) {
      var errorData = { error: error, status: null, message: null };
      if (response !== null && typeof response === "object") {
        errorData.status = response.status;
        errorData.message = response.message;
      }
      return reject(JSON.stringify(errorData), response);
    }
    return resolve(response);
  };
}

export const APPLE = constants.SERVICES.APPLE;
export const GOOGLE = constants.SERVICES.GOOGLE;

export const config = function (configIn: any) {
  apple.readConfig(configIn);
  google.readConfig(configIn);
  verbose.setup(configIn);
};

export const setup = function (cb: Function) {
  if (!cb && Promise) {
    return new Promise(function (resolve, reject) {
      setup(handlePromisedFunctionCb(resolve, reject));
    });
  }
  async.series(
    [
      function (next: any) {
        apple.setup(next);
      },
      function (next: any) {
        google.setup(next);
      },
    ],
    cb
  );
};

// Figure out what type of receipt is??? GOOGLE or APPLE
export const getService = function (receipt: any) {
  if (!receipt) throw new Error("Receipt was null or undefined");

  if (typeof receipt === "string") {
    try {
      receipt = JSON.parse(receipt);
      return getReceiptType(receipt);
    } catch (err) {
      return APPLE;
    }
  }

  if (typeof receipt === "object") return getReceiptType(receipt);

  throw new Error("Invalid receipt");
};

const getReceiptType = (obj: any): string =>
  obj.signature || obj.purchaseToken ? GOOGLE : APPLE;

export const validate = function (service: any, receipt: any, cb: any) {
  if (receipt === undefined && cb === undefined) {
    // we are given 1 argument as: const promise = .validate(receipt)
    receipt = service;
    service = getService(receipt);
  }
  if (cb === undefined && typeof receipt === "function") {
    // we are given 2 arguments as: .validate(receipt, cb)
    cb = receipt;
    receipt = service;
    service = getService(receipt);
  }
  if (!cb && Promise) {
    return new Promise(function (resolve, reject) {
      validate(service, receipt, handlePromisedFunctionCb(resolve, reject));
    });
  }

  switch (service) {
    case APPLE:
      apple.validatePurchase(null, receipt, cb);
      break;
    case GOOGLE:
      google.validatePurchase(null, receipt, cb);
      break;
    default:
      return cb(new Error("invalid service given: " + service));
  }
};

export const validateOnce = function (
  service: any,
  secretOrPubKey: any,
  receipt: any,
  cb: any
) {
  if (receipt === undefined && cb === undefined) {
    // we are given 2 arguments as: const promise = .validateOnce(receipt, secretOrPubKey)
    receipt = service;
    service = getService(receipt);
  }
  if (cb === undefined && typeof receipt === "function") {
    // we are given 3 arguemnts as: .validateOnce(receipt, secretPubKey, cb)
    cb = receipt;
    receipt = service;
    service = getService(receipt);
  }

  if (!cb && Promise) {
    return new Promise(function (resolve, reject) {
      validateOnce(
        service,
        secretOrPubKey,
        receipt,
        handlePromisedFunctionCb(resolve, reject)
      );
    });
  }

  if (!secretOrPubKey && service !== APPLE /*&& service !== WINDOWS*/) {
    verbose.log("<.validateOnce>", service, receipt);
    return cb(
      new Error(
        "missing secret or public key for dynamic validation:" + service
      )
    );
  }

  switch (service) {
    case APPLE:
      apple.validatePurchase(secretOrPubKey, receipt, cb);
      break;
    case GOOGLE:
      google.validatePurchase(secretOrPubKey, receipt, cb);
      break;
    default:
      verbose.log("<.validateOnce>", secretOrPubKey, receipt);
      return cb(new Error("invalid service given: " + service));
  }
};

export const isValidated = function (response: any) {
  if (response && response.status === constants.VALIDATION.SUCCESS) {
    return true;
  }
  return false;
};

export const isExpired = function (purchasedItem: any) {
  if (!purchasedItem || !purchasedItem.transactionId) {
    throw new Error(
      "invalid purchased item given:\n" + JSON.stringify(purchasedItem)
    );
  }
  if (purchasedItem.cancellationDate) {
    // it has been cancelled
    return true;
  }
  if (!purchasedItem.expirationDate) {
    // there is no exipiration date with this item
    return false;
  }
  if (Date.now() - purchasedItem.expirationDate >= 0) {
    return true;
  }
  // has not exipired yet
  return false;
};

export const isCanceled = function (purchasedItem: any) {
  if (!purchasedItem || !purchasedItem.transactionId) {
    throw new Error(
      "invalid purchased item given:\n" + JSON.stringify(purchasedItem)
    );
  }
  if (purchasedItem.cancellationDate) {
    // it has been cancelled
    return true;
  }
  return false;
};

export const getPurchaseData = function (purchaseData: any, options: any) {
  if (!purchaseData || !purchaseData.service) return null;

  switch (purchaseData.service) {
    case APPLE:
      return apple.getPurchaseData(purchaseData, options);
    case GOOGLE:
      return google.getPurchaseData(purchaseData, options);
    default:
      return null;
  }
};

export const refreshGoogleToken = function (cb: any) {
  if (!cb && Promise) {
    return new Promise(function (resolve, reject) {
      refreshGoogleToken(handlePromisedFunctionCb(resolve, reject));
    });
  }
  google.refreshToken(cb);
};

// test use only
export const reset = function () {
  // resets google setup
  google.reset();
};
