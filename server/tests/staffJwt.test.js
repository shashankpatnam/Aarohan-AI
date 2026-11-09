import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { before, describe, it } from "node:test";
import mongoose from "mongoose";
import {
  applyTestAuthEnv,
  TEST_STAFF_JWT_SECRET,
} from "./helpers/staffAuth.js";
import {
  STAFF_JWT_ALGORITHM,
  STAFF_TOKEN_TYP,
  signStaffToken,
  verifyStaffToken,
} from "../utils/staffJwt.js";

describe("staff JWT algorithm and claims", () => {
  const user = {
    _id: new mongoose.Types.ObjectId(),
    tokenVersion: 0,
  };

  before(() => {
    applyTestAuthEnv();
  });

  it("signs and verifies an HS256 staff token", () => {
    const token = signStaffToken(user);
    const header = JSON.parse(
      Buffer.from(token.split(".")[0], "base64url").toString("utf8"),
    );
    assert.equal(header.alg, STAFF_JWT_ALGORITHM);

    const payload = verifyStaffToken(token);
    assert.ok(payload);
    assert.equal(payload.sub, String(user._id));
    assert.equal(payload.tv, 0);
  });

  it("rejects an expired JWT", () => {
    const token = signStaffToken(user, { expiresIn: "-1s" });
    assert.equal(verifyStaffToken(token), null);
  });

  it("rejects a tampered JWT", () => {
    const token = signStaffToken(user);
    const parts = token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    payload.tv = 99;
    parts[1] = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    assert.equal(verifyStaffToken(parts.join(".")), null);
  });

  it("rejects a token with missing typ", () => {
    const token = jwt.sign(
      { tv: 0 },
      TEST_STAFF_JWT_SECRET,
      {
        algorithm: STAFF_JWT_ALGORITHM,
        subject: String(user._id),
        expiresIn: "8h",
      },
    );
    assert.equal(verifyStaffToken(token), null);
  });

  it("rejects a token with the wrong typ", () => {
    const token = jwt.sign(
      { typ: "guest", tv: 0 },
      TEST_STAFF_JWT_SECRET,
      {
        algorithm: STAFF_JWT_ALGORITHM,
        subject: String(user._id),
        expiresIn: "8h",
      },
    );
    assert.equal(verifyStaffToken(token), null);
    assert.notEqual(STAFF_TOKEN_TYP, "guest");
  });

  it("rejects a token signed with an unsupported algorithm", () => {
    const token = jwt.sign(
      { typ: STAFF_TOKEN_TYP, tv: 0 },
      TEST_STAFF_JWT_SECRET,
      {
        algorithm: "HS384",
        subject: String(user._id),
        expiresIn: "8h",
      },
    );
    const header = JSON.parse(
      Buffer.from(token.split(".")[0], "base64url").toString("utf8"),
    );
    assert.equal(header.alg, "HS384");
    assert.equal(verifyStaffToken(token), null);
  });
});
