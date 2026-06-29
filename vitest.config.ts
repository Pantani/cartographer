import { coverageConfigDefaults, defineConfig } from "vitest/config";

const COVERAGE_THRESHOLD = 70;

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "src/**/*.test.ts",
        "src/**/*.it.test.ts",
        "src/**/__fixtures__/**",
      ],
      thresholds: {
        statements: COVERAGE_THRESHOLD,
        branches: COVERAGE_THRESHOLD,
        functions: COVERAGE_THRESHOLD,
        lines: COVERAGE_THRESHOLD,
      },
    },
  },
});
