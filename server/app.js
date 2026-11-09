import express from "express";
import cors from "cors";
import helmet from "helmet";
import leadRoutes from "./routes/leadRoutes.js";
import availabilityRoutes from "./routes/availabilityRoutes.js";
import visitsRoutes from "./routes/visitsRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import handoffRoutes from "./routes/handoffRoutes.js";
import createPublicRouter from "./routes/publicRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import staffRoutes from "./routes/staffRoutes.js";
import { requireStaffAuth } from "./middleware/requireStaffAuth.js";
import { createAuthRateLimiters } from "./middleware/authRateLimit.js";
import { configureTrustProxy } from "./utils/trustProxy.js";

export const JSON_BODY_LIMIT = "32kb";

function resolveClientOrigin() {
  const raw = process.env.CLIENT_URL?.trim();
  if (!raw || raw === "*") {
    return "http://localhost:5173";
  }
  return raw;
}

function configureSecurityHeaders(app) {
  const isProduction = process.env.NODE_ENV === "production";
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
        },
      },
      strictTransportSecurity: isProduction
        ? { maxAge: 15_552_000, includeSubDomains: true }
        : false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginEmbedderPolicy: false,
    }),
  );
}

/**
 * @param {{ authRateLimit?: Parameters<typeof createAuthRateLimiters>[0] }} [options]
 * @returns {import("express").Express}
 */
export function createApp(options = {}) {
  const app = express();

  configureTrustProxy(app);
  configureSecurityHeaders(app);

  app.use(
    cors({
      origin: resolveClientOrigin(),
      credentials: false,
    }),
  );

  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  const {
    loginIpLimiter,
    loginEmailLimiter,
    setupIpLimiter,
    guestSessionCreateLimiter,
  } = createAuthRateLimiters(options.authRateLimit);
  app.use("/api/auth/setup", setupIpLimiter);
  app.use("/api/auth/login", loginIpLimiter, loginEmailLimiter);
  app.use("/api/auth", authRoutes);
  app.use("/api/staff", requireStaffAuth, staffRoutes);
  app.use("/api/leads", requireStaffAuth, leadRoutes);
  app.use("/api/availability", requireStaffAuth, availabilityRoutes);
  app.use("/api/visits", requireStaffAuth, visitsRoutes);
  app.use("/api/analytics", requireStaffAuth, analyticsRoutes);
  app.use("/api/handoffs", requireStaffAuth, handoffRoutes);
  app.use("/api/public", createPublicRouter(guestSessionCreateLimiter));

  app.get("/", (req, res) => {
    res.json({
      success: true,
      message: "Aarohan AI backend is running",
    });
  });

  app.get("/api/health", (req, res) => {
    res.json({
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  });

  app.use((err, req, res, next) => {
    if (err?.type === "entity.too.large" || err?.status === 413) {
      return res.status(413).json({
        success: false,
        message: "Request payload is too large",
      });
    }
    if (err instanceof SyntaxError && "body" in err) {
      return res.status(400).json({
        success: false,
        message: "Invalid JSON payload",
      });
    }
    return next(err);
  });

  return app;
}
