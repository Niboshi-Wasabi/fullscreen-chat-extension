import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
    reporters: ["default", "junit"],
    outputFile: { junit: ".harness-artifacts/test-results.xml" },
    restoreMocks: true,
  },
});
