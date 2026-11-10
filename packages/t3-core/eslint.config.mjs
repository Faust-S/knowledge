// Flat ESLint config for the IWXA Workspace shell. Kept intentionally lean:
// this is a static SPA, so we lean on TypeScript for type safety and only
// use lint to catch obvious mistakes (unused vars, unreachable code, etc.).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default [
  {
    ignores: [
      "dist/**",
      "release/**",
      "node_modules/**",
      "artifacts/**",
      "coverage/**",
      "**/*.snap",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-escape": "off",
      "no-control-regex": "off",
    },
  },
  {
    files: ["src/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.es2022 },
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-escape": "off",
      "no-control-regex": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
      sourceType: "module",
    },
  },
];
