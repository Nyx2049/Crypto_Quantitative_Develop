import { defineConfig } from "@playwright/test";
import process from "node:process";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  workers: 1,
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:8787",
    // Existing local Chrome works without downloading another browser.
    channel: "chrome",
    headless: true,
    screenshot: "only-on-failure",
  },
  reporter: "list",
});
