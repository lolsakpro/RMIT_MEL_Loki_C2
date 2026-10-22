/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_AUTH_MODE?: "demo" | "tide";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
