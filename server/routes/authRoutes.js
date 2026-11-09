import express from "express";
import {
  getCurrentStaff,
  loginStaff,
  logoutStaff,
  setupInitialAdmin,
} from "../controllers/authController.js";
import { requireStaffAuth } from "../middleware/requireStaffAuth.js";

const router = express.Router();

router.post("/setup", setupInitialAdmin);
router.post("/login", loginStaff);
router.post("/logout", requireStaffAuth, logoutStaff);
router.get("/me", requireStaffAuth, getCurrentStaff);

export default router;
