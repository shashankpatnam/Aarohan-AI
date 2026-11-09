import mongoose from "mongoose";

export async function mongoSupportsTransactions() {
  const db = mongoose.connection.db;
  if (!db) {
    return false;
  }

  try {
    const hello = await db.admin().command({ hello: 1 });
    return Boolean(hello.setName) || hello.msg === "isdbgrid";
  } catch {
    return false;
  }
}
