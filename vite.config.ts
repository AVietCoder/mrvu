import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
    }),
    nitro(),
    react(),
  ],
  resolve: {
    // Mảng alias để match CHÍNH XÁC (regex) — tránh việc alias dạng chuỗi
    // "exceljs" ăn luôn các subpath như "exceljs/dist/...".
    alias: [
      { find: "@", replacement: `${process.cwd()}/src` },
      // exceljs's default (Node) entry does `require("fs")`, which the bogus
      // "fs" stub package breaks khi Nitro bundle server. Bản browser của
      // exceljs (dist/exceljs.min.js) là self-contained (không cần fs/stream).
      { find: /^exceljs$/, replacement: "exceljs/dist/exceljs.min.js" },
    ],
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
});
