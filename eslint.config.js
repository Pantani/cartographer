// ESLint flat config.
// Cyclomatic and cognitive complexity ceilings = 10 are project invariants.
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "**/__fixtures__/**"],
  },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      sonarjs,
    },
    rules: {
      // Project invariant — do not disable. Refactor anything that exceeds it.
      complexity: ["error", 10],
      "sonarjs/cognitive-complexity": ["error", 10],

      // Keep units small and honest.
      "max-depth": ["error", 4],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
    },
  },
  {
    // Tests may be looser on return-type annotations.
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/explicit-module-boundary-types": "off",
    },
  },
);
