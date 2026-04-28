// @ts-check
/**
 * ESLint flat config for mcp-memoria.
 *
 * Goals:
 * - Type-aware linting on `src/**\/*.ts` to enforce zero `any` and zero
 *   unsafe-* patterns. The dominio of Fase 1 must compile clean.
 * - Reject `// @ts-ignore`, `// @ts-nocheck`, and `as any` casts.
 * - Require explicit return types on exports and constrain type imports.
 * - Light-weight rules (non type-aware) for `tests/**` and `scripts/**`
 *   so that test fixtures and helper scripts don't fight the strictness
 *   intended for the production code.
 */

import tseslint from "typescript-eslint";
import eslint from "@eslint/js";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },

  // ───── Production source: type-aware, strictest rules ─────────────────
  {
    files: ["src/**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ── 1.6 Cero `any` y type-safety total ────────────────────────────
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: false,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
        },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: false, allowAny: false, allowNullish: false },
      ],
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: false,
          allowNullableBoolean: false,
          allowNullableString: false,
          allowNullableNumber: false,
          allowAny: false,
        },
      ],

      // ── Block `// @ts-ignore` etc. — only `// @ts-expect-error` allowed
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": { descriptionFormat: "^: .+$" },
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
          minimumDescriptionLength: 10,
        },
      ],

      // ── Block `as any` and friends via syntax restriction ─────────────
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression > TSAnyKeyword",
          message: "`as any` is forbidden — use Zod/runtime parsing instead.",
        },
        {
          selector: "TSTypeAssertion > TSAnyKeyword",
          message: "`<any>` cast is forbidden.",
        },
      ],

      // ── House style ──────────────────────────────────────────────────
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      eqeqeq: ["error", "always"],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },

  // ───── Tests and scripts: looser ──────────────────────────────────────
  {
    files: ["tests/**/*.ts", "scripts/**/*.ts"],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        project: false,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": "off",
    },
  },
);
