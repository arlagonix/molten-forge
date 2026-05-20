import React, { type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import "@radix-ui/themes/styles.css";

import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import { Theme as RadixTheme } from "@radix-ui/themes";
import { ThemeProvider, useTheme } from "@/lib/theme";
import "./index.css";

function RadixThemeBridge({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();

  return (
    <RadixTheme
      accentColor="gray"
      appearance={resolvedTheme}
      className="chat-forge-radix-theme"
      grayColor="gray"
      hasBackground={false}
      radius="full"
      scaling="95%"
    >
      {children}
    </RadixTheme>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <RadixThemeBridge>
        <App />
        <Toaster position="bottom-right" />
      </RadixThemeBridge>
    </ThemeProvider>
  </React.StrictMode>,
);
