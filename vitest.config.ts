import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/db/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
