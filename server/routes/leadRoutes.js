import express from "express";
import {
  createLead,
  getLeadById,
  listLeads,
  postLeadChat,
  updateLead,
} from "../controllers/leadController.js";
import visitRoutes from "./visitRoutes.js";

const router = express.Router();

router.get("/", listLeads);
router.post("/", createLead);
router.use("/:id/visits", visitRoutes);
router.post("/:id/chat", postLeadChat);
router.patch("/:id", updateLead);
router.get("/:id", getLeadById);

export default router;
