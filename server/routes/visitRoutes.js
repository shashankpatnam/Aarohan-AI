import express from "express";
import { createVisit } from "../controllers/visitController.js";

const router = express.Router({ mergeParams: true });

router.post("/", createVisit);

export default router;
