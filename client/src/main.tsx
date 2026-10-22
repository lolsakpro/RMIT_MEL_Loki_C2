import React from "react";
import ReactDOM from "react-dom/client";
import { TideCloakContextProvider } from "@tidecloak/react";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TideCloakContextProvider
      configUrl="/tidecloak.json"
      config={{ useDPoP: { mode: "strict", alg: "ES256" } }}
    >
      <App />
    </TideCloakContextProvider>
  </React.StrictMode>
);
