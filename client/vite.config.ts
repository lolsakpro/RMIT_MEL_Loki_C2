import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const relayPage = readFileSync(new URL("./public/tide_dpop_auth.html", import.meta.url));

function tideDpopRelay(): Plugin {
  return {
    name: "tide-dpop-relay",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        if (!pathname.startsWith("/tide_dpop/") || !pathname.endsWith("/tide_dpop_auth.html")) {
          next();
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'");
        res.setHeader("Allow-CSP-From", "*");
        res.end(relayPage);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        if (!pathname.startsWith("/tide_dpop/") || !pathname.endsWith("/tide_dpop_auth.html")) {
          next();
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'");
        res.setHeader("Allow-CSP-From", "*");
        res.end(relayPage);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tideDpopRelay()],
  server: { host: "localhost" },
  preview: { host: "localhost" },
});
