import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { initTheme } from "./lib/theme";
import { applyConfigFromUrl } from "./lib/supabaseConfig";
import "./styles.css";

// Import a Supabase config carried in a #cfg=… 续接链接 before anything reads it.
applyConfigFromUrl();
initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
