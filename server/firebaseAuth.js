import { createVerify } from "node:crypto";

const FIREBASE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const CLOCK_SKEW_SECONDS = 300;

let certCache = {
  expiresAt: 0,
  certs: {}
};

function decodeBase64Url(segment) {
  const normalized = String(segment || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function decodeJwtJson(segment) {
  return JSON.parse(decodeBase64Url(segment).toString("utf8"));
}

function parseMaxAge(cacheControl) {
  const match = String(cacheControl || "").match(/max-age=(\d+)/i);
  return match ? Number(match[1]) * 1000 : 60 * 60 * 1000;
}

async function fetchFirebaseCerts(fetchImpl = fetch) {
  const now = Date.now();
  if (certCache.expiresAt > now && Object.keys(certCache.certs).length) {
    return certCache.certs;
  }

  const response = await fetchImpl(FIREBASE_CERTS_URL);
  if (!response.ok) {
    throw new Error("Unable to fetch Firebase signing certificates");
  }
  const certs = await response.json();
  certCache = {
    certs,
    expiresAt: now + parseMaxAge(response.headers?.get?.("cache-control"))
  };
  return certs;
}

function verifySignature({ signingInput, signature, certificate }) {
  const verifier = createVerify("RSA-SHA256");
  verifier.update(signingInput);
  verifier.end();
  return verifier.verify(certificate, signature);
}

export async function verifyFirebaseIdToken(idToken, options = {}) {
  const projectId = String(options.projectId || "").trim();
  if (!projectId) throw new Error("Firebase project id is required");

  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("Invalid Firebase ID token");

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJwtJson(encodedHeader);
  const payload = decodeJwtJson(encodedPayload);

  if (header.alg !== "RS256") throw new Error("Unsupported Firebase token algorithm");
  if (!header.kid) throw new Error("Firebase token is missing key id");

  const certs = await fetchFirebaseCerts(options.fetchImpl);
  const certificate = certs[header.kid];
  if (!certificate) throw new Error("Unknown Firebase signing key");

  const signature = decodeBase64Url(encodedSignature);
  const valid = verifySignature({
    signingInput: `${encodedHeader}.${encodedPayload}`,
    signature,
    certificate
  });
  if (!valid) throw new Error("Invalid Firebase token signature");

  const nowSeconds = Math.floor((options.nowMs || Date.now()) / 1000);
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  if (payload.iss !== expectedIssuer) throw new Error("Invalid Firebase token issuer");
  if (payload.aud !== projectId) throw new Error("Invalid Firebase token audience");
  if (!payload.sub || String(payload.sub).length > 128) throw new Error("Invalid Firebase token subject");
  if (Number(payload.exp || 0) <= nowSeconds - CLOCK_SKEW_SECONDS) throw new Error("Expired Firebase token");
  if (Number(payload.iat || 0) > nowSeconds + CLOCK_SKEW_SECONDS) throw new Error("Firebase token issued in the future");

  return {
    uid: String(payload.sub),
    email: payload.email || "",
    emailVerified: Boolean(payload.email_verified),
    name: payload.name || "",
    picture: payload.picture || "",
    firebase: payload.firebase || {}
  };
}
