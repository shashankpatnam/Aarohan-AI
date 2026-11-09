import mongoose from "mongoose";
import StaffUser, {
  INITIAL_ADMIN_BOOTSTRAP_SLOT,
  STAFF_ROLES,
} from "../models/StaffUser.js";
import { isValidContactEmail } from "../utils/contactValidation.js";
import { secretsMatch } from "../utils/secretCompare.js";
import {
  getDummyPasswordHash,
  hashStaffPassword,
  isUsableLoginPassword,
  validateStaffPassword,
  verifyStaffPassword,
} from "../utils/staffPassword.js";
import { getStaffJwtSecret, signStaffToken } from "../utils/staffJwt.js";
import { serializeStaffUser } from "../utils/staffSerializer.js";
import { mongoSupportsTransactions } from "../utils/mongoTransactions.js";

const GENERIC_LOGIN_ERROR = "Invalid email or password";

function isDuplicateKeyError(error) {
  return Boolean(error && error.code === 11000);
}

function bootstrapSlotConflict(error) {
  if (!isDuplicateKeyError(error)) {
    return false;
  }
  const key = error.keyPattern || error.keyValue || {};
  return Object.prototype.hasOwnProperty.call(key, "bootstrapSlot");
}

export const MIN_SETUP_SECRET_LENGTH = 16;
export const SETUP_ALREADY_COMPLETED_MESSAGE =
  "Initial admin has already been created";

function getSetupSecret() {
  const secret = process.env.STAFF_SETUP_SECRET?.trim() || "";
  if (secret.length < MIN_SETUP_SECRET_LENGTH) {
    return "";
  }
  return secret;
}

async function initialAdminExists() {
  const existing = await StaffUser.findOne({ role: "admin" }).select("_id").lean();
  return Boolean(existing);
}

export async function setupInitialAdmin(req, res) {
  try {
    await StaffUser.createIndexes();

    if (await initialAdminExists()) {
      return res.status(409).json({
        success: false,
        message: SETUP_ALREADY_COMPLETED_MESSAGE,
      });
    }

    if (!getStaffJwtSecret()) {
      return res.status(500).json({
        success: false,
        message: "Staff authentication is not configured",
      });
    }

    const configuredSecret = getSetupSecret();
    if (!configuredSecret) {
      return res.status(503).json({
        success: false,
        message: "Admin setup is not configured",
      });
    }

    const providedSecret =
      typeof req.body?.setupSecret === "string" ? req.body.setupSecret : "";
    if (!secretsMatch(providedSecret, configuredSecret)) {
      return res.status(403).json({
        success: false,
        message: "Invalid setup secret",
      });
    }

    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    const errors = [];
    if (!name || name.length > 120) {
      errors.push("Name is required");
    }
    if (!isValidContactEmail(email)) {
      errors.push("A valid email is required");
    }
    const passwordError = validateStaffPassword(password);
    if (passwordError) {
      errors.push(passwordError);
    }
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: errors[0],
        errors,
      });
    }

    const passwordHash = await hashStaffPassword(password);

    try {
      const admin = await StaffUser.create({
        name,
        email,
        passwordHash,
        role: "admin",
        isActive: true,
        bootstrapSlot: INITIAL_ADMIN_BOOTSTRAP_SLOT,
      });

      const token = signStaffToken(admin);
      return res.status(201).json({
        success: true,
        token,
        user: serializeStaffUser(admin),
      });
    } catch (error) {
      if (bootstrapSlotConflict(error)) {
        return res.status(409).json({
          success: false,
          message: SETUP_ALREADY_COMPLETED_MESSAGE,
        });
      }
      if (isDuplicateKeyError(error)) {
        return res.status(409).json({
          success: false,
          message: "A staff account with this email already exists",
        });
      }
      throw error;
    }
  } catch (error) {
    console.error("setupInitialAdmin error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to complete admin setup",
    });
  }
}

export async function loginStaff(req, res) {
  try {
    if (!getStaffJwtSecret()) {
      return res.status(500).json({
        success: false,
        message: "Staff authentication is not configured",
      });
    }

    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = req.body?.password;

    if (!isUsableLoginPassword(password)) {
      return res.status(401).json({
        success: false,
        message: GENERIC_LOGIN_ERROR,
      });
    }

    const user = email
      ? await StaffUser.findOne({ email }).select("+passwordHash")
      : null;
    const passwordHash = user?.passwordHash || (await getDummyPasswordHash());
    const passwordOk = await verifyStaffPassword(password, passwordHash);

    if (!passwordOk || !user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: GENERIC_LOGIN_ERROR,
      });
    }

    const token = signStaffToken(user);
    return res.json({
      success: true,
      token,
      user: serializeStaffUser(user),
    });
  } catch (error) {
    console.error("loginStaff error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to log in",
    });
  }
}

export async function logoutStaff(req, res) {
  try {
    await StaffUser.updateOne(
      { _id: req.staffUser._id },
      { $inc: { tokenVersion: 1 } },
    );
    return res.json({
      success: true,
      message: "Logged out",
    });
  } catch (error) {
    console.error("logoutStaff error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to log out",
    });
  }
}

export async function getCurrentStaff(req, res) {
  return res.json({
    success: true,
    user: serializeStaffUser(req.staffUser),
  });
}

export async function createStaffAccount(req, res) {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const role = typeof req.body?.role === "string" ? req.body.role.trim() : "staff";

    const errors = [];
    if (!name || name.length > 120) {
      errors.push("Name is required");
    }
    if (!isValidContactEmail(email)) {
      errors.push("A valid email is required");
    }
    const passwordError = validateStaffPassword(password);
    if (passwordError) {
      errors.push(passwordError);
    }
    if (!STAFF_ROLES.includes(role)) {
      errors.push("Role must be admin or staff");
    }
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: errors[0],
        errors,
      });
    }

    const passwordHash = await hashStaffPassword(password);

    try {
      const created = await StaffUser.create({
        name,
        email,
        passwordHash,
        role,
        isActive: true,
      });

      return res.status(201).json({
        success: true,
        user: serializeStaffUser(created),
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return res.status(409).json({
          success: false,
          message: "A staff account with this email already exists",
        });
      }
      throw error;
    }
  } catch (error) {
    console.error("createStaffAccount error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to create staff account",
    });
  }
}

export async function listStaffAccounts(req, res) {
  try {
    const users = await StaffUser.find({}).sort({ createdAt: 1 });
    return res.json({
      success: true,
      staff: users.map(serializeStaffUser),
    });
  } catch (error) {
    console.error("listStaffAccounts error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to list staff accounts",
    });
  }
}

export async function updateStaffAccount(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || String(new mongoose.Types.ObjectId(id)) !== id) {
      return res.status(400).json({
        success: false,
        message: "Invalid staff id",
      });
    }

    const staff = await StaffUser.findById(id);
    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff account not found",
      });
    }

    const hasIsActive = Object.prototype.hasOwnProperty.call(req.body ?? {}, "isActive");
    if (hasIsActive && typeof req.body.isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be a boolean",
      });
    }

    const deactivating =
      hasIsActive && req.body.isActive === false && staff.isActive === true;

    if (deactivating && String(req.staffUser?._id) === String(staff._id)) {
      return res.status(409).json({
        success: false,
        message: "You cannot deactivate your own account",
      });
    }

    if (deactivating && staff.role === "admin") {
      if (!(await mongoSupportsTransactions())) {
        return res.status(503).json({
          success: false,
          message: "Administrator deactivation requires MongoDB transaction support",
        });
      }

      const session = await mongoose.startSession();
      let updated;
      try {
        await session.withTransaction(async () => {
          // Serialize all admin deactivations by writing the same active admin document.
          // A concurrent transaction conflicts here and is retried against a fresh snapshot.
          const anchor = await StaffUser.findOne({ role: "admin", isActive: true })
            .sort({ _id: 1 })
            .select("_id updatedAt")
            .session(session);
          if (!anchor) {
            throw Object.assign(new Error("Cannot deactivate the last active administrator"), { code: "LAST_ACTIVE_ADMIN" });
          }

          await StaffUser.updateOne(
            { _id: anchor._id, role: "admin", isActive: true },
            { $set: { updatedAt: new Date(Math.max(Date.now(), (anchor.updatedAt?.getTime?.() ?? 0) + 1)) } },
            { session },
          );

          const target = await StaffUser.findOne({ _id: id, isActive: true }).session(session);
          if (!target) {
            throw Object.assign(new Error("Staff account not found or already inactive"), { code: "STAFF_STATE_CHANGED" });
          }
          const activeAdminCount = await StaffUser.countDocuments({ role: "admin", isActive: true }).session(session);
          if (target.role === "admin" && activeAdminCount <= 1) {
            throw Object.assign(new Error("Cannot deactivate the last active administrator"), { code: "LAST_ACTIVE_ADMIN" });
          }

          target.isActive = false;
          target.tokenVersion = (target.tokenVersion ?? 0) + 1;
          await target.save({ session });
          updated = target;
        });
      } catch (error) {
        if (error.code === "LAST_ACTIVE_ADMIN") {
          return res.status(409).json({ success: false, message: error.message });
        }
        if (error.code === "STAFF_STATE_CHANGED") {
          return res.status(409).json({ success: false, message: "Staff account state changed; refresh and try again" });
        }
        throw error;
      } finally {
        await session.endSession();
      }

      return res.json({ success: true, user: serializeStaffUser(updated) });
    }

    if (hasIsActive) {
      staff.isActive = req.body.isActive;
      if (req.body.isActive === false) {
        staff.tokenVersion = (staff.tokenVersion ?? 0) + 1;
      }
    }

    await staff.save();

    return res.json({
      success: true,
      user: serializeStaffUser(staff),
    });
  } catch (error) {
    console.error("updateStaffAccount error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to update staff account",
    });
  }
}
