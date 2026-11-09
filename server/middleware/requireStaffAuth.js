import mongoose from "mongoose";
import StaffUser from "../models/StaffUser.js";
import { getStaffJwtSecret, verifyStaffToken } from "../utils/staffJwt.js";

function parseBearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== "string") {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    return null;
  }
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

function unauthorized(res, message = "Authentication required") {
  return res.status(401).json({
    success: false,
    message,
  });
}

/**
 * Requires a valid staff JWT. Guest session tokens are rejected.
 */
export async function requireStaffAuth(req, res, next) {
  try {
    const token = parseBearerToken(req);
    if (!token) {
      return unauthorized(res);
    }

    if (!getStaffJwtSecret()) {
      return res.status(500).json({
        success: false,
        message: "Staff authentication is not configured",
      });
    }

    const payload = verifyStaffToken(token);
    if (!payload) {
      return unauthorized(res, "Invalid or expired staff credentials");
    }

    if (!mongoose.Types.ObjectId.isValid(payload.sub)) {
      return unauthorized(res, "Invalid or expired staff credentials");
    }

    const staffUser = await StaffUser.findById(payload.sub);
    if (!staffUser) {
      return unauthorized(res, "Invalid or expired staff credentials");
    }

    if (!staffUser.isActive) {
      return res.status(403).json({
        success: false,
        message: "Staff account is inactive",
      });
    }

    if ((staffUser.tokenVersion ?? 0) !== payload.tv) {
      return unauthorized(res, "Invalid or expired staff credentials");
    }

    req.staffUser = staffUser;
    return next();
  } catch (error) {
    console.error("requireStaffAuth error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to authenticate staff",
    });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.staffUser || req.staffUser.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Admin access required",
    });
  }
  return next();
}
