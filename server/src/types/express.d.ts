import type { JWTPayload } from "jose";

declare global {
  namespace Express {
    interface Request {
      auth?: JWTPayload & {
        realm_access?: { roles?: string[] };
        resource_access?: Record<string, { roles?: string[] }>;
        sub: string;
        tideuserkey?: string;
        preferred_username?: string;
        name?: string;
      };
    }
  }
}

export {};
