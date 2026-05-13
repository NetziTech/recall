// @ts-check
/**
 * ESLint flat config for recall.
 *
 * Goals:
 * - Type-aware linting on `src/**\/*.ts` to enforce zero `any` and zero
 *   unsafe-* patterns. The dominio of Fase 1 must compile clean.
 * - Reject `// @ts-ignore`, `// @ts-nocheck`, and `as any` casts.
 * - Require explicit return types on exports and constrain type imports.
 * - Light-weight rules (non type-aware) for `tests/**` and `scripts/**`
 *   so that test fixtures and helper scripts don't fight the strictness
 *   intended for the production code.
 * - FP-001 / W-Q4-CI-GATE — keep the `MasterKeyFingerprint` hex prefix
 *   contained: `.toHex()` may only be called from the encryption audit
 *   log adapter, and the `master_key_fp` snake_case column identifier
 *   must not leak into the composition root, the logger, or the
 *   presentation layers (CLI / MCP). The procedural barrier (JSDoc +
 *   audit) is solid in the current tree; this rule prevents a future
 *   regression by another agent that hasn't read the contract.
 */

import tseslint from "typescript-eslint";
import eslint from "@eslint/js";

/**
 * Base no-restricted-syntax entries shared by every production source
 * config block. New file-specific configs append more entries to this
 * list (ESLint flat config replaces the rule wholesale, so a sub-config
 * that wants the tighter rule must include the baseline too).
 */
const BASE_RESTRICTED_SYNTAX = [
  {
    selector: "TSAsExpression > TSAnyKeyword",
    message: "`as any` is forbidden — use Zod/runtime parsing instead.",
  },
  {
    selector: "TSTypeAssertion > TSAnyKeyword",
    message: "`<any>` cast is forbidden.",
  },
];

const TOHEX_RESTRICTION = {
  selector: "CallExpression[callee.property.name='toHex']",
  message:
    "FP-001 / W-Q4-CI-GATE: `.toHex()` on MasterKeyFingerprint may only be " +
    "called from `sqlite-encryption-audit-repository.ts`. Surfacing the hex " +
    "prefix anywhere else creates correlation risk against the master key. " +
    "Use `MasterKeyFingerprint.toString()` (returns the redacted constant) " +
    "for logging or wiring.",
};

const MASTER_KEY_FP_RESTRICTION = {
  selector: "Identifier[name='master_key_fp']",
  message:
    "FP-001 / W-Q4-CI-GATE: `master_key_fp` (the snake_case audit-log column) " +
    "must not surface in composition/, the logger, or the presentation " +
    "layers (CLI / MCP). It is internal to the encryption audit adapter.",
};

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

      // ── Block `as any` and friends + .toHex() leak (FP-001) ──────────
      "no-restricted-syntax": [
        "error",
        ...BASE_RESTRICTED_SYNTAX,
        TOHEX_RESTRICTION,
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

  // ───── Encryption audit log adapter: ONLY site allowed to call .toHex()
  //
  // Per ADR-005 Q4 + JSDoc invariant in
  // `code/src/modules/encryption/infrastructure/persistence/sqlite-encryption-audit-repository.ts`,
  // the audit adapter is the only legitimate caller of
  // `MasterKeyFingerprint.toHex()`. This override drops the TOHEX
  // restriction for that one file while keeping the rest of
  // `BASE_RESTRICTED_SYNTAX` (and every other rule from the production
  // block above) intact. ESLint flat config replaces the rule wholesale
  // for matching files, so the baseline entries are repeated here.
  {
    files: [
      "src/modules/encryption/infrastructure/persistence/sqlite-encryption-audit-repository.ts",
    ],
    rules: {
      "no-restricted-syntax": ["error", ...BASE_RESTRICTED_SYNTAX],
    },
  },

  // ───── Composition root + logger + presentation: tighter rule ────────
  //
  // FP-001 / W-Q4-CI-GATE: these layers MUST NOT reference
  // `master_key_fp` in identifier position (object property access,
  // destructuring, declaration). The snake_case column name is internal
  // to the encryption audit adapter; any reference here would indicate
  // the hex prefix has leaked out of its containment.
  {
    files: [
      "src/composition/**/*.ts",
      "src/shared/infrastructure/logger/**/*.ts",
      "src/modules/cli/**/*.ts",
      "src/modules/mcp-server/**/*.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...BASE_RESTRICTED_SYNTAX,
        TOHEX_RESTRICTION,
        MASTER_KEY_FP_RESTRICTION,
      ],
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
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "off",
    },
  },
);
