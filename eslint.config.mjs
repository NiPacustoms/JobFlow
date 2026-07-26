import { createRequire } from "module";
import nextPlugin from "@next/eslint-plugin-next";
import prettierConfig from "eslint-config-prettier";

const require = createRequire(import.meta.url);
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const reactPlugin = require("eslint-plugin-react");
const reactHooksPlugin = require("eslint-plugin-react-hooks");

// TypeScript recommended flat config (built manually to avoid raw-plugin ESM resolution)
const tsRecommendedRules = {
  "@typescript-eslint/ban-ts-comment": "error",
  "no-array-constructor": "off",
  "@typescript-eslint/no-array-constructor": "error",
  "@typescript-eslint/no-duplicate-enum-values": "error",
  "@typescript-eslint/no-empty-object-type": "error",
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-extra-non-null-assertion": "error",
  "@typescript-eslint/no-misused-new": "error",
  "@typescript-eslint/no-namespace": "error",
  "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
  "@typescript-eslint/no-require-imports": "error",
  "@typescript-eslint/no-this-alias": "error",
  "@typescript-eslint/no-unnecessary-type-constraint": "error",
  "@typescript-eslint/no-unsafe-declaration-merging": "error",
  "@typescript-eslint/no-unsafe-function-type": "error",
  "no-unused-expressions": "off",
  "@typescript-eslint/no-unused-expressions": "error",
  "no-unused-vars": "off",
  "@typescript-eslint/no-unused-vars": [
    "warn",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
    },
  ],
  "@typescript-eslint/no-wrapper-object-types": "error",
  "@typescript-eslint/prefer-as-const": "error",
  "@typescript-eslint/prefer-namespace-keyword": "error",
  "@typescript-eslint/triple-slash-reference": "error",
};

const tsEslintRecommendedCompat = {
  "constructor-super": "off",
  "getter-return": "off",
  "no-class-assign": "off",
  "no-const-assign": "off",
  "no-dupe-args": "off",
  "no-dupe-class-members": "off",
  "no-dupe-keys": "off",
  "no-func-assign": "off",
  "no-import-assign": "off",
  "no-new-symbol": "off",
  "no-obj-calls": "off",
  "no-redeclare": "off",
  "no-setter-return": "off",
  "no-this-before-super": "off",
  "no-undef": "off",
  "no-unreachable": "off",
  "no-unsafe-negation": "off",
  "no-var": "error",
  "no-with": "off",
  "prefer-const": "error",
  "prefer-rest-params": "error",
  "prefer-spread": "error",
};

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    name: "typescript-eslint/base",
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: { ...tsEslintRecommendedCompat, ...tsRecommendedRules },
  },
  nextPlugin.flatConfig.coreWebVitals,
  {
    plugins: { react: reactPlugin, "react-hooks": reactHooksPlugin },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
    settings: { react: { version: "detect" } },
  },
  { rules: prettierConfig.rules ?? prettierConfig },
  { rules: { "no-useless-catch": "off" } },
  {
    files: [
      "lib/**/*.ts", "lib/**/*.tsx",
      "app/**/*.ts", "app/**/*.tsx",
      "components/**/*.ts", "components/**/*.tsx"
    ],
    ignores: [
      "lib/utils/logger.ts",
      "lib/errors/ErrorLogger.ts"
    ],
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["**/*.js", "**/*.jsx"],
    languageOptions: {
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off",
    },
  },
  {
    ignores: [
      ".firebase/**",
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "next-env.d.ts",
      "node_modules/**",
      "*.config.js",
      "*.config.ts",
      "*.config.mjs",
      "y/**",
      "functions/**",
      "tests/**",
      "lib/services/__tests__/**",
      // Generierte Playwright-Artefakte (gitignored) – kein Quellcode.
      "playwright-report/**",
      "test-results/**",
      "blob-report/**",
    ],
  },
];
