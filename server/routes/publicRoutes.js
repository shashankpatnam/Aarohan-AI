import express from "express";
import {
  createGuestSession,
  getGuestSession,
  postGuestSessionChat,
  postGuestSessionContact,
  postGuestSessionCallback,
} from "../controllers/guestSessionController.js";
import { requireGuestSession } from "../middleware/requireGuestSession.js";
import { getPublicProjectSummaries } from "../controllers/publicProjectController.js";
import {
  createPublicVisit,
  getPublicVisitAvailability,
} from "../controllers/publicVisitController.js";

/**
 * @param {import("express").RequestHandler} [guestSessionCreateLimiter]
 */
export default function createPublicRouter(guestSessionCreateLimiter = (_req, _res, next) => next()) {
  const router = express.Router();

  router.get("/projects", getPublicProjectSummaries);
  router.post("/sessions", guestSessionCreateLimiter, createGuestSession);
  router.get("/sessions/:sessionId", requireGuestSession, getGuestSession);
  router.post(
    "/sessions/:sessionId/chat",
    requireGuestSession,
    postGuestSessionChat,
  );
  router.post(
    "/sessions/:sessionId/contact",
    requireGuestSession,
    postGuestSessionContact,
  );
  router.post(
    "/sessions/:sessionId/callback",
    requireGuestSession,
    postGuestSessionCallback,
  );
  router.get(
    "/sessions/:sessionId/visit-availability",
    requireGuestSession,
    getPublicVisitAvailability,
  );
  router.post(
    "/sessions/:sessionId/visits",
    requireGuestSession,
    createPublicVisit,
  );

  return router;
}
