const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function normalizeMongoUri(uri) {
  return uri.trim().replace(/\/+$/, "");
}

/**
 * Rejects Atlas, mongodb+srv, the configured MONGODB_URI, and default local mongod.
 * MongoMemoryServer URIs use loopback + an ephemeral port (not 27017).
 *
 * @param {unknown} uri
 */
export function assertTestMongoUri(uri) {
  if (typeof uri !== "string" || !uri.trim()) {
    throw new Error(
      "TEST_MONGO_GUARD: missing MongoDB URI. Tests must use MongoMemoryServer.",
    );
  }

  const raw = uri.trim();

  if (/^mongodb\+srv:/i.test(raw) || /mongodb\.net/i.test(raw)) {
    throw new Error(
      "TEST_MONGO_GUARD: refusing to connect to Atlas or mongodb+srv. Tests must use MongoMemoryServer.",
    );
  }

  const envUri = process.env.MONGODB_URI?.trim();
  if (envUri && normalizeMongoUri(raw) === normalizeMongoUri(envUri)) {
    throw new Error(
      "TEST_MONGO_GUARD: refusing to connect to MONGODB_URI from the environment. Tests must use MongoMemoryServer.",
    );
  }

  let parsed;
  try {
    parsed = new URL(raw.replace(/^mongodb:/i, "http:"));
  } catch {
    throw new Error(
      "TEST_MONGO_GUARD: unparseable MongoDB URI. Tests must use MongoMemoryServer.",
    );
  }

  const host = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `TEST_MONGO_GUARD: refusing host "${host}". Tests must use MongoMemoryServer on loopback.`,
    );
  }

  const port = parsed.port ? Number.parseInt(parsed.port, 10) : 27017;
  if (port === 27017) {
    throw new Error(
      "TEST_MONGO_GUARD: refusing default mongod port 27017. Tests must use MongoMemoryServer, not a development database.",
    );
  }
}
