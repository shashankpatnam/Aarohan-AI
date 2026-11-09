import express from "express";
import {
  createStaffAccount,
  listStaffAccounts,
  updateStaffAccount,
} from "../controllers/authController.js";
import { requireAdmin } from "../middleware/requireStaffAuth.js";
import StaffUser from "../models/StaffUser.js";

const router = express.Router();

router.get("/eligible", async (req, res) => {
  try {
    const staff = await StaffUser.find({ role: "staff", isActive: true })
      .select("name")
      .sort({ name: 1, _id: 1 });
    return res.json({ success: true, staff: staff.map((person) => ({ id: person.id, name: person.name })) });
  } catch (error) {
    console.error("listEligibleStaff error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to list eligible staff" });
  }
});

router.use(requireAdmin);
router.get("/", listStaffAccounts);
router.post("/", createStaffAccount);
router.patch("/:id", updateStaffAccount);

export default router;
