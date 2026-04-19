// eslint.config.js
import globals from "globals";
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettierPlugin from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

export default [
  // Ignore generated/build artifacts and external folders early.
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "generated/**",
      "prisma/generated/**",
      "coverage/**",
      "src/modules/mock/**",
    ],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // Apply to app TypeScript sources only
  {
    files: ["src/**/*.ts", "api/**/*.ts"],

    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.eslint.json",
        sourceType: "module",
        ecmaVersion: "latest",
      },
      globals:{
        ...globals.node,
      },
    },

    plugins: {
      "@typescript-eslint": tsPlugin,
      prettier: prettierPlugin,
    },

    rules: {
      // ── TypeScript rules ──────────────────────────────

      // Warn on variables typed as `any` explicitly
      "@typescript-eslint/no-explicit-any": "warn",

      // Error on variables declared but never used
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",   // allow _unusedParam convention
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Prevent async functions that don't use await
      "@typescript-eslint/require-await": "error",

      // Enforce return types on functions (catches missing returns)
      "@typescript-eslint/explicit-function-return-type": "off", // off for now, turn on later

      // ── General JS rules ──────────────────────────────

      // No leftover console.log in code
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // Catch missing await on promises (silent bug killer)
      "no-async-promise-executor": "error",

      // No unreachable code after return/throw
      "no-unreachable": "error",

      // No duplicate keys in objects
      "no-dupe-keys": "error",

      // Base JS rules that produce false positives in TypeScript files
      "no-undef": "off",
      "no-redeclare": "off",

      // ── Prettier formatting ───────────────────────────
      "prettier/prettier": "error",
    },
  },

  // Disable ESLint rules that conflict with Prettier
  prettierConfig,
];