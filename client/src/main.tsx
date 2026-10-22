import React from "react";
import ReactDOM from "react-dom/client";
import { TideCloakContextProvider } from "@tidecloak/react";
import { DemoAuthProvider, TideAuthBridge } from "./lib/auth";
import App from "./App";
import "./styles.css";

const authMode = import.meta.env.VITE_AUTH_MODE ?? (import.meta.env.DEV ? "demo" : "tide");
const root = ReactDOM.createRoot(document.getElementById("root")!);

if (authMode === "demo") {
  root.render(
    <React.StrictMode>
      <DemoAuthProvider><App /></DemoAuthProvider>
    </React.StrictMode>,
  );
} else {
  root.render(
    <React.StrictMode>
      <TideCloakContextProvider
        configUrl="/tidecloak.json"
        config={{ useDPoP: { mode: "strict", alg: "ES256" } }}
      >
        <TideAuthBridge><App /></TideAuthBridge>
      </TideCloakContextProvider>
    </React.StrictMode>,
  );
}
