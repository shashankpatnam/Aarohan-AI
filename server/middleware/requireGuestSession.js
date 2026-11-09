import mongoose from "mongoose";
import GuestSession from "../models/GuestSession.js";
import { verifyGuestSessionToken } from "../utils/guestSessionToken.js";

const GENERIC_SESSION_AUTH_MESSAGE = "Invalid session credentials";

function isValidObjectId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return false;
  }
  return String(new mongoose.Types.ObjectId(id)) === id;
}

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
 * Loads guest session, verifies Bearer token and expiry.
 * Missing sessions and invalid tokens share the same 401 so IDs are not enumerable.
 * Expired sessions still return 410 when the token is valid (see Phase 5B report).
 * Sets req.guestSession on success.
 */
export async function requireGuestSession(req, res, next) {
  try {
    const token = parseBearerToken(req);
    if (!token) {
      return unauthorized(res);
    }

    const { sessionId } = req.params;
    if (!isValidObjectId(sessionId)) {
      return unauthorized(res, GENERIC_SESSION_AUTH_MESSAGE);
    }

    const session = await GuestSession.findById(sessionId);
    if (!session) {
      return unauthorized(res, GENERIC_SESSION_AUTH_MESSAGE);
    }

    if (
      !session.tokenHash ||
      !verifyGuestSessionToken(token, session.tokenHash)
    ) {
      return unauthorized(res, GENERIC_SESSION_AUTH_MESSAGE);
    }

    if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
      return res.status(410).json({
        success: false,
        message: "Session expired",
      });
    }

    req.guestSession = session;
    return next();
  } catch (error) {
    console.error("requireGuestSession error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to authenticate guest session",
    });
  }
}
