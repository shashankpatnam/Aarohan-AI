import assert from "node:assert/strict";
import mongoose from "mongoose";
import { describe, it } from "node:test";
import { assertTestMongoUri } from "./helpers/assertTestMongoUri.js";
import "./helpers/installMongooseConnectGuard.js";

describe("TEST_MONGO_GUARD", () => {
  it("rejects Atlas mongodb+srv URIs", () => {
    assert.throws(
      () =>
        assertTestMongoUri(
          "mongodb+srv://user:pass@cluster.mongodb.net/Realestate-AI",
        ),
      /TEST_MONGO_GUARD/,
    );
  });

  it("rejects the configured MONGODB_URI", () => {
    const previous = process.env.MONGODB_URI;
    process.env.MONGODB_URI = "mongodb://127.0.0.1:27018/aarohan-dev";
    try {
      assert.throws(
        () => assertTestMongoUri("mongodb://127.0.0.1:27018/aarohan-dev"),
        /MONGODB_URI from the environment/,
      );
    } finally {
      if (previous === undefined) {
        delete process.env.MONGODB_URI;
      } else {
        process.env.MONGODB_URI = previous;
      }
    }
  });

  it("rejects default local mongod on port 27017", () => {
    assert.throws(
      () => assertTestMongoUri("mongodb://127.0.0.1:27017/aarohan"),
      /27017/,
    );
  });

  it("allows a MongoMemoryServer-style loopback URI", () => {
    assert.doesNotThrow(() =>
      assertTestMongoUri("mongodb://127.0.0.1:61234/test"),
    );
  });

  it("blocks mongoose.connect to an Atlas URI before a network attempt", () => {
    assert.throws(
      () =>
        mongoose.connect(
          "mongodb+srv://user:pass@cluster.mongodb.net/Realestate-AI",
        ),
      /TEST_MONGO_GUARD/,
    );
  });
});
