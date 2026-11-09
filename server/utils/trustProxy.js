/**
 * Enables Express `trust proxy` only for an explicit hop count.
 * Does not accept `true` or untrusted wildcard settings, which would
 * honor arbitrary X-Forwarded-For values.
 *
 * @param {import("express").Express} app
 */
export function configureTrustProxy(app) {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) {
    return;
  }

  if (!/^[1-5]$/.test(raw)) {
    console.error(
      "TRUST_PROXY ignored: set it to an integer hop count from 1 to 5 (for example 1).",
    );
    return;
  }

  app.set("trust proxy", Number.parseInt(raw, 10));
}
