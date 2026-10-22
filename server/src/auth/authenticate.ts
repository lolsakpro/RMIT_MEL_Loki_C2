import { createLocalJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { NextFunction, Request, Response } from "express";
import { DpopError, verifyDpop } from "./verifyDpop.js";
import type { TideAdapterConfig } from "./tideConfig.js";

export function createAuthenticator(config: TideAdapterConfig) {
  const jwks = createLocalJWKSet(config.jwk);
  const issuer = `${config["auth-server-url"].replace(/\/+$/, "")}/realms/${config.realm}`;

  return async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.get("authorization");
    if (!authHeader || !/^DPoP /i.test(authHeader)) {
      res.status(401).json({ error: "A DPoP-authenticated Tide access token is required." });
      return;
    }

    const token = authHeader.slice(authHeader.indexOf(" ") + 1);
    if (!token) {
      res.status(401).json({ error: "The Tide access token is missing." });
      return;
    }

    try {
      const { payload } = await jwtVerify(token, jwks, { issuer });
      if (payload.azp !== config.resource) {
        throw new Error("Token client does not match the Tide adapter.");
      }
      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        throw new Error("Token subject is missing.");
      }
      if (typeof payload.iat === "number" && payload.iat > Math.floor(Date.now() / 1000) + 60) {
        throw new Error("Token issue time is in the future.");
      }
      await verifyDpop(
        {
          url: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
          method: req.method,
          headers: { get: (name) => req.get(name) ?? null },
        },
        token,
        payload as JWTPayload & { cnf?: { jkt?: string } },
        { trustForwardedHeaders: false },
      );
      req.auth = payload as JWTPayload & {
        realm_access?: { roles?: string[] };
        sub: string;
      };
      next();
    } catch (error) {
      const reason = error instanceof DpopError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown authentication error.";
      console.warn("Rejected API authentication:", reason);
      res.status(401).json({ error: "Tide token or DPoP proof was invalid." });
    }
  };
}

export function createDemoAuthenticator() {
  return function authenticateDemo(req: Request, res: Response, next: NextFunction): void {
    const role = req.get("x-kads-demo-role");
    const sub = req.get("x-kads-demo-sub");
    const demoUsers = {
      student: { sub: "demo-student", key: "demo-key-student", name: "Alex Morgan" },
      counsellor: { sub: "demo-counsellor", key: "demo-key-counsellor", name: "Sam Taylor" },
      admin: { sub: "demo-admin", key: "demo-key-admin", name: "KADS Administrator" },
    } as const;
    if (
      (role !== "student" && role !== "counsellor" && role !== "admin")
      || !sub || demoUsers[role].sub !== sub
    ) {
      res.status(401).json({ error: "Choose a valid local demo account." });
      return;
    }
    const user = demoUsers[role];
    req.auth = {
      sub: user.sub,
      name: user.name,
      preferred_username: user.name,
      tideuserkey: user.key,
      realm_access: { roles: [role] },
      ...(role === "admin" ? { resource_access: { "realm-management": { roles: ["tide-realm-admin"] } } } : {}),
    };
    next();
  };
}

export function requireRealmRole(role: string) {
  return function checkRole(req: Request, res: Response, next: NextFunction): void {
    const roles = req.auth?.realm_access?.roles;
    if (!roles?.includes(role)) {
      res.status(403).json({ error: `The ${role} role is required.` });
      return;
    }
    next();
  };
}

export function requireClientRole(clientId: string, role: string) {
  return function checkClientRole(req: Request, res: Response, next: NextFunction): void {
    const roles = req.auth?.resource_access?.[clientId]?.roles;
    if (!roles?.includes(role)) {
      res.status(403).json({ error: `The ${role} role on ${clientId} is required.` });
      return;
    }
    next();
  };
}
