import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: { alias: { '@': path.resolve(import.meta.dirname, "src") } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as import('vite').UserConfig)
