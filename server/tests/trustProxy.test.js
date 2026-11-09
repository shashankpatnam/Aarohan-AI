import assert from "node:assert/strict";
import express from "express";
import { afterEach, describe, it } from "node:test";
import { configureTrustProxy } from "../utils/trustProxy.js";

describe("configureTrustProxy", () => {
  const previous = process.env.TRUST_PROXY;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = previous;
    }
  });

  it("does not enable trust proxy when unset", () => {
    delete process.env.TRUST_PROXY;
    const app = express();
    configureTrustProxy(app);
    assert.equal(app.get("trust proxy"), false);
  });

  it("ignores true and other unsafe values", () => {
    const appTrue = express();
    process.env.TRUST_PROXY = "true";
    configureTrustProxy(appTrue);
    assert.equal(appTrue.get("trust proxy"), false);

    const appStar = express();
    process.env.TRUST_PROXY = "*";
    configureTrustProxy(appStar);
    assert.equal(appStar.get("trust proxy"), false);
  });

  it("enables a numeric hop count from 1 to 5", () => {
    const app = express();
    process.env.TRUST_PROXY = "1";
    configureTrustProxy(app);
    assert.equal(app.get("trust proxy"), 1);
  });
});
