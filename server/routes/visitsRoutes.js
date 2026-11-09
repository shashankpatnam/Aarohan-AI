import express from "express";
import { listVisits, updateVisitStatus } from "../controllers/visitController.js";

const router = express.Router();

router.get("/", listVisits);
router.patch("/:id/status", updateVisitStatus);

export default router;
