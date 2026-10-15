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
    nitro({
      vercel: {
        // SEO Studio (/seo-studio/*): viết bài AI, gọi DataForSEO… cần lâu hơn mặc định.
        // 300 giây là mức tối đa của gói Hobby khi bật Fluid Compute (mặc định cho dự án mới).
        // Nếu tắt Fluid Compute thì đặt SEO_MAX_DURATION=60 trong biến môi trường build.
        functionRules: {
          "/seo-studio/**": { maxDuration: Number(process.env.SEO_MAX_DURATION || 300) },
        },
      },
    }),
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
      // Cũng vì gói "fs" giả đó: thư viện postgres (SEO Studio) `import fs from 'fs'` sẽ trỏ nhầm
      // vào gói giả. Ép về module có sẵn của Node.
      { find: /^fs$/, replacement: "node:fs" },
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
