import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installZhCN } from "./i18n/zhCN";
import "./index.css";
import "./operations.css";
import "./design-system.css";
import "./responsive.css";
import "./dgx.css";
import "./cockpit.css";
import "./product.css";
import { installFlowMotion } from './flowMotion';

const stopFlowMotion = installFlowMotion();
if (import.meta.hot) import.meta.hot.dispose(stopFlowMotion);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

installZhCN();
