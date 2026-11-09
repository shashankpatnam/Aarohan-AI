import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "./installMongooseConnectGuard.js";

/**
 * Starts an isolated in-memory MongoDB and connects Mongoose only to it.
 * @returns {Promise<import("mongodb-memory-server").MongoMemoryServer>}
 */
export async function startTestMongo() {
  const memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri());
  return memoryServer;
}

/**
 * @param {import("mongodb-memory-server").MongoMemoryServer|null|undefined} memoryServer
 */
export async function stopTestMongo(memoryServer) {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (memoryServer) {
    await memoryServer.stop();
  }
}
