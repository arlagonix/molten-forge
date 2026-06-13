import "@radix-ui/themes/styles.css";
import React, { type ReactNode } from "react";
import ReactDOM from "react-dom/client";

import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { Theme as RadixTheme } from "@radix-ui/themes";
import App from "./App";
import "./index.css";

function RadixThemeBridge({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();

  return (
    <RadixTheme
      accentColor="gray"
      appearance={resolvedTheme}
      className="molten-forge-radix-theme"
      grayColor="gray"
      hasBackground={false}
      radius="full"
      scaling="95%"
      style={
        {
          "--default-font-family": "var(--font-sans)",
          "--heading-font-family": "var(--font-sans)",
          "--code-font-family": "var(--font-mono)",
          fontFamily: "var(--font-sans)",
        } as React.CSSProperties
      }
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
      </RadixThemeBridge>
      {/*
        Toaster MUST live outside <RadixThemeBridge>. Radix Themes renders
        `.radix-themes` with `isolation: isolate` (a stacking context). Any
        toast inside it is trapped in that context, so its z-index can never
        rise above the Radix Dialog overlay, which portals to document.body.
        Mounting it here (inside ThemeProvider, which is context-only, but
        outside `.radix-themes`) puts the toast in the body root stacking
        context where its z-index actually wins.
      */}
      <Toaster position="bottom-right" />
    </ThemeProvider>
  </React.StrictMode>,
);
