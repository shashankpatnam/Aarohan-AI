import GuestSession from "../models/GuestSession.js";
import { LEAD_PROJECTS } from "../models/Lead.js";
import { validateChatMessageBody } from "../services/leadChatShared.js";
import { processGuestSessionChat } from "../services/guestChatService.js";
import { convertGuestSessionToLead } from "../services/guestSessionConversionService.js";
import {
  buildGuestSessionPublicDto,
  requestGuestSessionCallback,
} from "../services/guestSessionCallbackService.js";
import { serializeGuestSessionPublic } from "../services/guestSessionSerializer.js";
import { validateGuestContactBody } from "../utils/contactValidation.js";
import { validateGuestCallbackBody } from "../utils/guestCallbackValidation.js";
import {
  generateGuestSessionToken,
  hashGuestSessionToken,
} from "../utils/guestSessionToken.js";

const DEFAULT_TTL_DAYS = 30;

function readSessionTtlMs() {
  const raw = process.env.GUEST_SESSION_TTL_DAYS?.trim();
  const days = raw ? Number.parseInt(raw, 10) : DEFAULT_TTL_DAYS;
  if (!Number.isFinite(days) || days < 1) {
    return DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000;
  }
  return days * 24 * 60 * 60 * 1000;
}

function validateCreateSessionBody(body) {
  const errors = [];

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { errors: ["request body must be an object"] };
  }

  const unexpectedKeys = Object.keys(body).filter(
    (key) => key !== "intent" && key !== "project",
  );
  if (unexpectedKeys.length > 0) {
    errors.push(`unexpected field(s): ${unexpectedKeys.join(", ")}`);
  }

  if (body.intent === "general") {
    if (Object.hasOwn(body, "project")) {
      errors.push("project is not allowed for general intent");
    }
    return errors.length > 0 ? { errors } : { data: { project: null } };
  }

  if (body.intent !== "project") {
    errors.push('intent must be either "general" or "project"');
    return { errors };
  }

  const project = typeof body.project === "string" ? body.project.trim() : "";
  if (!project) {
    errors.push("project is required for project intent");
  } else if (!LEAD_PROJECTS.includes(project)) {
    errors.push(`project must be one of: ${LEAD_PROJECTS.join(", ")}`);
  }

  if (errors.length > 0) {
    return { errors };
  }

  return { data: { project } };
}

export async function createGuestSession(req, res) {
  try {
    const validated = validateCreateSessionBody(req.body);
    if (validated.errors) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validated.errors,
      });
    }

    const rawToken = generateGuestSessionToken();
    const tokenHash = hashGuestSessionToken(rawToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + readSessionTtlMs());

    const session = await GuestSession.create({
      project: null,
      initialProject: validated.data.project,
      tokenHash,
      expiresAt,
      lastActivityAt: now,
    });

    return res.status(201).json({
      success: true,
      sessionToken: rawToken,
      session: serializeGuestSessionPublic(session),
    });
  } catch (error) {
    console.error("createGuestSession error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to create guest session",
    });
  }
}

export async function getGuestSession(req, res) {
  try {
    const session = await buildGuestSessionPublicDto(req.guestSession);
    return res.json({
      success: true,
      session,
    });
  } catch (error) {
    console.error("getGuestSession error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch guest session",
    });
  }
}

export async function postGuestSessionChat(req, res) {
  try {
    const validated = validateChatMessageBody(req.body ?? {});
    if (validated.errors) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validated.errors,
      });
    }

    const chatResult = await processGuestSessionChat(
      req.guestSession,
      validated.data.message,
    );

    return res.json({
      success: true,
      session: serializeGuestSessionPublic(req.guestSession),
      messages: chatResult.messages,
      needsHumanHandoff: chatResult.needsHumanHandoff,
    });
  } catch (error) {
    console.error("postGuestSessionChat error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to process chat message",
    });
  }
}

export async function postGuestSessionContact(req, res) {
  try {
    const validated = validateGuestContactBody(req.body ?? {});
    if (validated.errors) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validated.errors,
      });
    }

    const result = await convertGuestSessionToLead(
      req.guestSession,
      validated.data,
    );

    if (result.error === "not_found") {
      return res.status(404).json({
        success: false,
        message: "Session not found",
      });
    }

    if (result.error === "conflict") {
      return res.status(409).json({
        success: false,
        message: "Contact capture could not be completed. Please try again.",
      });
    }

    const statusCode = result.alreadyConverted ? 200 : 201;

    return res.status(statusCode).json({
      success: true,
      contactCaptured: true,
      confirmation: result.confirmation,
      session: await buildGuestSessionPublicDto(result.session),
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: Object.values(error.errors).map((e) => e.message),
      });
    }

    console.error("postGuestSessionContact error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to save contact details",
    });
  }
}

export async function postGuestSessionCallback(req, res) {
  try {
    const validated = validateGuestCallbackBody(req.body ?? {});
    if (validated.errors) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validated.errors,
      });
    }

    const result = await requestGuestSessionCallback(
      req.guestSession,
      validated.data,
    );

    if (result.error === "not_found") {
      return res.status(404).json({
        success: false,
        message: "Session not found",
      });
    }

    if (result.error === "contact_required") {
      return res.status(422).json({
        success: false,
        code: "contact_required",
        message:
          "Please share your contact details before requesting a callback.",
      });
    }

    if (result.error === "lead_missing") {
      return res.status(500).json({
        success: false,
        message: "Could not process callback request",
      });
    }

    return res.status(result.alreadyRequested ? 200 : 201).json({
      success: true,
      callbackRequested: true,
      confirmation: result.confirmation,
      session: result.session,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: Object.values(error.errors).map((e) => e.message),
      });
    }

    console.error("postGuestSessionCallback error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to request callback",
    });
  }
}
