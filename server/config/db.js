import mongoose from "mongoose";

function sanitizeMongoMessage(message) {
  if (typeof message !== "string") return "";
  return message.replace(/mongodb(\+srv)?:\/\/[^\s'"]+/gi, "mongodb://[hidden]");
}

export async function connectDB() {
  const uri = process.env.MONGODB_URI?.trim();

  if (!uri) {
    console.error(
      "Startup failed: MONGODB_URI is not set. Add it to server/.env and try again.",
    );
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log("MongoDB connected");
  } catch (error) {
    console.error("Startup failed: Could not connect to MongoDB.");
    if (error?.message) {
      console.error(sanitizeMongoMessage(error.message));
    }
    process.exit(1);
  }
}
