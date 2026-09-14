import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installZhCN } from "./i18n/zhCN";
import "./index.css";
import "./operations.css";
import "./design-system.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

installZhCN();
