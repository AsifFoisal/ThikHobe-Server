import { createRemoteJWKSet, jwtVerify } from "jose";

import { findUserByEmail, findUserById, publicUser } from "../db.js";

const authUrl = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const issuer = process.env.JWT_ISSUER ?? "thikhobe";
const audience = process.env.JWT_AUDIENCE ?? "thikhobe-client";
const jwksUrl =
  (process.env.BETTER_AUTH_JWKS_URL ?? "").trim() || `${authUrl}/api/auth/jwks`;

const jwks = createRemoteJWKSet(new URL(jwksUrl));

const unauthorized = (res, message) =>
  res
    .status(401)
    .set("WWW-Authenticate", "Bearer")
    .json({ success: false, message });

/** Verifies the Better Auth JWT and attaches its identity to req.user. */
export async function verifyToken(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ");
  if (scheme !== "Bearer" || !token) {
    return unauthorized(res, "Unauthorized: token missing");
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks, { issuer, audience }));
  } catch {
    return unauthorized(res, "Unauthorized: invalid or expired token");
  }

  // The JWT establishes identity; authorization still uses the fresh database record.
  // Role and profile always come from the database, not from client input.
  const user = (await findUserById(payload.sub ?? payload.id)) ??
    (typeof payload.email === "string" ? await findUserByEmail(payload.email) : null);
  if (!user) return unauthorized(res, "Unauthorized: user not found");

  req.user = publicUser(user);
  next();
}

const requireRole = (role) => (req, res, next) => {
  if (!req.user) return unauthorized(res, "Unauthorized");
  if (req.user.role !== role) {
    return res
      .status(403)
      .json({ success: false, message: `Forbidden: ${role}s only` });
  }
  next();
};

export const verifyCustomer = requireRole("customer");
export const verifyTechnician = requireRole("technician");
export const verifyAdmin = requireRole("admin");
