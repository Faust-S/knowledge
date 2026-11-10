import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AVAILABLE_MODULES } from "./composition";
import "./styles.css";
import "./styles/a11y.css";

// Keep the compile-time module loader table anchored in the entry
// graph so each module's dynamic-import chunk is emitted, even while
// AppShell is still doing its legacy direct rendering (PROMPT 18).
void AVAILABLE_MODULES;



createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
