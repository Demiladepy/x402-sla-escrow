import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { enableMotion } from "./lib/motion.ts";
import "./styles.css";

// Before React paints, so `[data-reveal]` is hidden without a flash of the
// final state. If this module never runs, the CSS gate never matches and the
// page is simply visible — the failure mode of a broken bundle is an unanimated
// page, not a blank one.
enableMotion();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
