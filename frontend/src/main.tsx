import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource/bagel-fat-one/latin-400.css";
import "@fontsource-variable/onest/wght.css";
import "@fontsource-variable/source-serif-4/standard.css";
import "@fontsource/baloo-2/devanagari-800.css";
import "@fontsource/tiro-devanagari-hindi/devanagari-400.css";

import App from "./App";
import "./index.css";
import { ThemeProvider } from "./theme";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
