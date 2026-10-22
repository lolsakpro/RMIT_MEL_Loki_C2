import type { JWTPayload } from "jose";

declare global {
  namespace Express {
    interface Request {
      auth?: JWTPayload & {
        realm_access?: { roles?: string[] };
        sub: string;
      };
    }
  }
}

export {};
