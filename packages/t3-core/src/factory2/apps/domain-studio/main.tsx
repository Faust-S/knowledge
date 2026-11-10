import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DomainStudioRouteShell } from "./DomainStudioRouteShell";
import "../../../styles.css";
import "../../../styles/a11y.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DomainStudioRouteShell />
  </StrictMode>,
);
