/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Python server serves the page at "/" and every other file under "/static/",
// so the build goes straight into the Python package with that base path.
// `npm run dev` proxies /api to a running `cust-codex-status --web` (see TUTORIAL.md, step 9).
declare const process: { env: Record<string, string | undefined> };   // Node's, typed here instead of adding @types/node
const API = process.env.CCS_API ?? "http://127.0.0.1:8765";

export default defineConfig({
  plugins: [react()],
  base: "/static/",
  build: {
    outDir: "../src/cust_codex_status/web/static",
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: false,
    target: "es2022",
    rollupOptions: { input: { main: "index.html", v2: "v2.html" } },   // two pages: the first design (index) and the second (v2)
  },
  server: {
    port: 5173,
    proxy: {
      // changeOrigin rewrites Host, and Origin is rewritten too: the Python server only accepts its own (anti DNS-rebinding / CSRF).
      "/api": { target: API, changeOrigin: true, headers: { Origin: API } },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: { modules: { classNameStrategy: "non-scoped" } },
  },
});
