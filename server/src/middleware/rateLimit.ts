import rateLimit from "express-rate-limit";
import { isTest } from "../config/env.js";

const json = (res: { status: (n: number) => { json: (b: unknown) => void } }) =>
  res.status(429).json({ error: { code: "rate_limited", message: "Too many requests. Please slow down." } });

// Tight limit for auth endpoints (login/register/verify/reset) to blunt brute force.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => isTest, // deterministic tests fire many logins
  handler: (_req, res) => json(res),
});

// Looser default for the rest of the API.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => isTest,
  handler: (_req, res) => json(res),
});
