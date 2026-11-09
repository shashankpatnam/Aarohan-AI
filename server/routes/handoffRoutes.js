import express from "express";
import {
  assignHandoff,
  listHandoffs,
  resolveHandoffRequest,
} from "../controllers/handoffController.js";

const router = express.Router();

router.get("/", listHandoffs);
router.patch("/:id/assign", assignHandoff);
router.patch("/:id/resolve", resolveHandoffRequest);

export default router;
