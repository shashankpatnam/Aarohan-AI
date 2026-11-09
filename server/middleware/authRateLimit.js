import crypto from "crypto";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

const GENERIC_429 = {
  success: false,
  message: "Too many attempts. Please try again later.",
};

function isRateLimitDisabled() {
  return process.env.AUTH_RATE_LIMIT_DISABLED === "true";
}

function passthrough(_req, _res, next) {
  next();
}

function readPositiveInt(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function windowMs() {
  return readPositiveInt("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000);
}

function hashEmailForKey(email) {
  return crypto.createHash("sha256").update(email, "utf8").digest("hex");
}

function clientIpKey(req) {
  const ip = req.ip || req.socket?.remoteAddress || "127.0.0.1";
  return ipKeyGenerator(ip);
}

function sendTooManyAttempts(req, res) {
  res.status(429).json(GENERIC_429);
}

function buildLimiter(options) {
  return rateLimit({
    windowMs: options.windowMs ?? windowMs(),
    standardHeaders: true,
    legacyHeaders: false,
    handler: sendTooManyAttempts,
    validate: {
      xForwardedForHeader: false,
      default: true,
    },
    ...options,
  });
}

function resolveWindowMs(overrides) {
  if (Number.isInteger(overrides.windowMs) && overrides.windowMs >= 1) {
    return overrides.windowMs;
  }
  return windowMs();
}

/**
 * Creates login (IP + hashed-email) and setup (IP) limiters.
 * Limiters are built at app construction so tests can vary config per app.
 *
 * @param {{
 *   disabled?: boolean,
 *   windowMs?: number,
 *   loginIpMax?: number,
 *   loginEmailMax?: number,
 *   setupIpMax?: number,
 *   guestSessionCreateIpMax?: number,
 * }} [overrides]
 */
export function createAuthRateLimiters(overrides = {}) {
  const disabled =
    typeof overrides.disabled === "boolean"
      ? overrides.disabled
      : isRateLimitDisabled();

  if (disabled) {
    return {
      loginIpLimiter: passthrough,
      loginEmailLimiter: passthrough,
      setupIpLimiter: passthrough,
      guestSessionCreateLimiter: passthrough,
    };
  }

  const resolvedWindowMs = resolveWindowMs(overrides);

  const loginIpLimiter = buildLimiter({
    windowMs: resolvedWindowMs,
    limit:
      overrides.loginIpMax ?? readPositiveInt("AUTH_LOGIN_IP_MAX", 20),
    keyGenerator: (req) => `login-ip:${clientIpKey(req)}`,
  });

  const loginEmailLimiter = buildLimiter({
    windowMs: resolvedWindowMs,
    limit:
      overrides.loginEmailMax ?? readPositiveInt("AUTH_LOGIN_EMAIL_MAX", 10),
    keyGenerator: (req) => {
      const email =
        typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      if (!email) {
        return `login-email:missing:${clientIpKey(req)}`;
      }
      return `login-email:${hashEmailForKey(email)}`;
    },
  });

  const setupIpLimiter = buildLimiter({
    windowMs: resolvedWindowMs,
    limit: overrides.setupIpMax ?? readPositiveInt("AUTH_SETUP_IP_MAX", 10),
    keyGenerator: (req) => `setup-ip:${clientIpKey(req)}`,
  });

  const guestSessionCreateLimiter = buildLimiter({
    windowMs: resolvedWindowMs,
    limit:
      overrides.guestSessionCreateIpMax ??
      readPositiveInt("GUEST_SESSION_CREATE_IP_MAX", 30),
    keyGenerator: (req) => `guest-session-create-ip:${clientIpKey(req)}`,
  });

  return {
    loginIpLimiter,
    loginEmailLimiter,
    setupIpLimiter,
    guestSessionCreateLimiter,
  };
}
