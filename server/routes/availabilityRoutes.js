import express from "express";
import { getAvailability } from "../controllers/availabilityController.js";

const router = express.Router();

router.get("/", getAvailability);

export default router;
