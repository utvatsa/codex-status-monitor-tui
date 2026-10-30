// Entry point: global styles, then the React tree. StrictMode runs effects twice in development only, which
// catches effects that forget to clean up (useSnapshot closes its EventSource for exactly that reason).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/ui/Toast";
import "./styles/tokens.css";
import "./styles/base.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
