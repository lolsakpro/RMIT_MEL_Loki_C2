import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { JSONWebKeySet } from "jose";

export interface TideAdapterConfig {
  realm: string;
  "auth-server-url": string;
  resource: string;
  vendorId?: string;
  jwk: JSONWebKeySet;
}

export function loadTideConfig(): TideAdapterConfig {
  const rawConfig = process.env.CLIENT_ADAPTER
    ? JSON.parse(process.env.CLIENT_ADAPTER) as TideAdapterConfig
    : JSON.parse(readFileSync(resolve(process.cwd(), process.env.TIDECLOAK_ADAPTER_PATH ?? "../client/public/tidecloak.json"), "utf8")) as TideAdapterConfig;

  if (!rawConfig.realm || !rawConfig["auth-server-url"] || !rawConfig.resource) {
    throw new Error("Tide adapter must include realm, auth-server-url, and resource.");
  }
  if (!rawConfig.jwk || !Array.isArray(rawConfig.jwk.keys) || rawConfig.jwk.keys.length === 0) {
    throw new Error("Tide adapter is missing its embedded jwk keys; export the Tide adapter with IGA enabled.");
  }

  return rawConfig;
}
