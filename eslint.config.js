// eslint.config.js
import globals from "globals";
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettierPlugin from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

export default [
  // Base JS recommended rules
  js.configs.recommended,

  // Apply to all TS files
  {
    files: ["**/*.ts"],

    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
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
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",   // allow _unusedParam convention
          varsIgnorePattern: "^_",
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

      // ── Prettier formatting ───────────────────────────
      "prettier/prettier": "error",
    },
  },

  // Ignore built output and node_modules
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "prisma/generated/**",
      "*.js",         // ignore root .js config files themselves
      "eslint.config.js",
    ],
  },

  // Disable ESLint rules that conflict with Prettier
  prettierConfig,
];