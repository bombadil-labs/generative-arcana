import { createRoot } from "react-dom/client";
import "@/styles/tokens.css"; // the Vitrine design tokens (must load first)
import "@/styles/base.css";
import "@/decks"; // registers every bundled deck and its card sketches
import { BrowserSessionProvider } from "@/auth/session";
import { App } from "@/app/App";

createRoot(document.getElementById("root")!).render(
  <BrowserSessionProvider>
    <App />
  </BrowserSessionProvider>,
);
