import mongoose from "mongoose";
import { assertTestMongoUri } from "./assertTestMongoUri.js";

const GUARD_FLAG = "__aarohanTestMongoGuardInstalled";

if (!mongoose.connect[GUARD_FLAG]) {
  const originalConnect = mongoose.connect.bind(mongoose);

  function guardedConnect(uri, ...args) {
    assertTestMongoUri(uri);
    return originalConnect(uri, ...args);
  }

  guardedConnect[GUARD_FLAG] = true;
  mongoose.connect = guardedConnect;
}
