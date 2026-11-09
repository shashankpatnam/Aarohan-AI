import dotenv from "dotenv";
import { connectDB } from "./config/db.js";
import { createApp } from "./app.js";

dotenv.config();

const app = createApp();
const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start();
