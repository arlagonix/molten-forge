import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";

const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
) as { version?: string };
const appVersion = packageJson.version ?? "0.0.0";
const appTitle = `Molten Forge v${appVersion}`;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  plugins: [
    {
      name: "molten-forge-app-title",
      transformIndexHtml(html) {
        return html.replace(/<title>.*<\/title>/, `<title>${appTitle}</title>`);
      },
    },
    react(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            rollupOptions: {
              external: [
                "7zip-bin",
                "node-7z",
                "pdf-parse",
                "officeparser",
                "@modelcontextprotocol/sdk",
                /^@modelcontextprotocol\/sdk\/.*/,
                "undici",
              ],
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, "electron/preload.ts"),
        vite: {
          build: {
            rollupOptions: {
              output: {
                format: "cjs",
                entryFileNames: "preload.cjs",
              },
            },
          },
        },
      },
      renderer: process.env.NODE_ENV === "test" ? undefined : {},
    }),
  ],
});
