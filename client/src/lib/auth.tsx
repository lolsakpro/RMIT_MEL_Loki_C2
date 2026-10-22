import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useAuthCallback, useTideCloak } from "@tidecloak/react";
import { demoDecrypt, demoEncrypt } from "./encryption";

export type DemoRole = "student" | "counsellor" | "admin";

export interface KadsAuthValue {
  mode: "demo" | "tide";
  isInitializing: boolean;
  initError: Error | null;
  isCallback: boolean;
  isProcessing: boolean;
  callbackError: Error | null;
  authenticated: boolean;
  token: string | null;
  IAMService: { secureFetch: (input: string | URL | RequestInfo, init?: RequestInit) => Promise<Response> };
  login: () => Promise<void>;
  logout: () => Promise<void>;
  hasRealmRole: (role: string) => boolean;
  hasClientRole: (role: string, resource?: string) => boolean;
  getValueFromIdToken: (key: string) => unknown;
  selectDemoRole: (role: DemoRole) => void;
  doEncrypt: (items: { data: string | Uint8Array; tags: string[] }[]) => Promise<(string | Uint8Array)[]>;
  doDecrypt: (items: { encrypted: string | Uint8Array; tags: string[] }[]) => Promise<(string | Uint8Array)[]>;
}

const AuthContext = createContext<KadsAuthValue | null>(null);
const DEMO_USERS: Record<DemoRole, { sub: string; name: string; tideUserKey: string }> = {
  student: { sub: "demo-student", name: "Alex Morgan", tideUserKey: "demo-key-student" },
  counsellor: { sub: "demo-counsellor", name: "Sam Taylor", tideUserKey: "demo-key-counsellor" },
  admin: { sub: "demo-admin", name: "KADS Administrator", tideUserKey: "demo-key-admin" },
};
const demoToken = "kads-local-demo-token";
const demoSecureFetch = async (input: string | URL | RequestInfo, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  const role = localStorage.getItem("kads-demo-role") as DemoRole | null;
  const user = role ? DEMO_USERS[role] : undefined;
  if (user && role) {
    headers.set("X-KADS-Demo-Role", role);
    headers.set("X-KADS-Demo-Sub", user.sub);
    headers.set("X-KADS-Demo-Name", user.name);
    headers.set("X-KADS-Demo-Tide-User-Key", user.tideUserKey);
  }
  return fetch(input, { ...init, headers });
};

export function DemoAuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<DemoRole | null>(() => {
    const stored = localStorage.getItem("kads-demo-role");
    return stored === "student" || stored === "counsellor" || stored === "admin" ? stored : null;
  });
  const user = role ? DEMO_USERS[role] : undefined;
  const value = useMemo<KadsAuthValue>(() => ({
    mode: "demo",
    isInitializing: false,
    initError: null,
    isCallback: false,
    isProcessing: false,
    callbackError: null,
    authenticated: !!role,
    token: role ? demoToken : null,
    IAMService: { secureFetch: demoSecureFetch },
    login: async () => {
      const selected = role ?? "student";
      localStorage.setItem("kads-demo-role", selected);
      setRole(selected);
    },
    logout: async () => {
      localStorage.removeItem("kads-demo-role");
      setRole(null);
    },
    hasRealmRole: (requested) => requested === role,
    hasClientRole: (requested, resource) => role === "admin" && requested === "tide-realm-admin" && resource === "realm-management",
    getValueFromIdToken: (key) => {
      if (key === "sub") return user?.sub;
      if (key === "preferred_username" || key === "name") return user?.name;
      return undefined;
    },
    selectDemoRole: (nextRole) => {
      localStorage.setItem("kads-demo-role", nextRole);
      setRole(nextRole);
    },
    doEncrypt: (items) => Promise.all(items.map(({ data, tags }) => demoEncrypt(data, tags[0] ?? ""))),
    doDecrypt: (items) => Promise.all(items.map(({ encrypted, tags }) => demoDecrypt(encrypted, tags[0] ?? ""))),
  }), [role, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function TideAuthBridge({ children }: { children: ReactNode }) {
  const tide = useTideCloak();
  const callback = useAuthCallback({
    onSuccess: (returnUrl) => {
      window.location.assign(returnUrl || "/");
    },
    onMissingVerifierRedirectTo: "/",
  });
  const value = useMemo<KadsAuthValue>(() => ({
    mode: "tide",
    isInitializing: tide.isInitializing,
    initError: tide.initError,
    isCallback: callback.isCallback,
    isProcessing: callback.isProcessing,
    callbackError: callback.error,
    authenticated: tide.authenticated,
    token: tide.token,
    IAMService: tide.IAMService,
    login: tide.login,
    logout: tide.logout,
    hasRealmRole: tide.hasRealmRole,
    hasClientRole: tide.hasClientRole,
    getValueFromIdToken: tide.getValueFromIdToken,
    selectDemoRole: () => undefined,
    doEncrypt: tide.doEncrypt,
    doDecrypt: tide.doDecrypt,
  }), [tide, callback]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useKadsAuth(): KadsAuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("KADS authentication provider is missing.");
  return context;
}
