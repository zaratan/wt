import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginPrettier from "eslint-plugin-prettier";
import globals from "globals";

// Layer boundaries are spelled out in CLAUDE.md ("Architecture — hard rules").
// The rules below are the machine-enforced half of that table, and
// src/lib/boundaries.test.ts proves each one still fires.
//
// TWO WAYS THESE GO INERT, both already caught here:
//
// 1. `no-restricted-imports` matches the import *string*, not the resolved
//    path. Listing only the qualified ui/ glob lets `../ui/App.js` straight through.
//    Hence RELATIVE_UI below. chiro-tools shipped that regression.
//
// 2. In flat config, a later block that redefines a rule REPLACES it for the
//    files it matches — it does not merge. A second block setting
//    `no-restricted-imports` on src/lib/** silently dropped the
//    node:child_process ban across the whole of lib/. The blocks below are
//    therefore DISJOINT: exactly one of them sets `no-restricted-imports` for
//    any given file, and each states its full set of restrictions.

const SPAWN_PATHS = [
  {
    name: "node:child_process",
    message:
      "Spawn through lib/exec/run.ts — it owns env scrubbing, timeouts and process-group kills.",
  },
  {
    name: "child_process",
    message: "Use lib/exec/run.ts (and the node: prefix).",
  },
];

const UI_GROUP = {
  group: [
    "ink",
    "ink-*",
    "react",
    "react-*",
    "**/ui/**",
    "./ui/**",
    "../ui/**",
    "../../ui/**",
    "../../../ui/**",
  ],
  message: "This layer must stay UI-free (no ink, no react, no ui/).",
};

const ENTRY_POINT_GROUP = {
  // index/app import ink and every screen; one hop through them would drag the
  // whole UI layer back in.
  group: ["**/index.js", "../index.js", "**/app.js", "../app.js"],
  message: "Importing the entry point re-introduces the UI layer transitively.",
};

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "*.config.ts",
      "*.config.js",
      "scripts/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  eslintConfigPrettier,
  {
    plugins: {
      prettier: eslintPluginPrettier,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "prettier/prettier": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
    },
  },

  // --- Block 1: lib/exec/ — the one place allowed to spawn ------------------
  {
    files: ["src/lib/exec/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [UI_GROUP, ENTRY_POINT_GROUP] },
      ],
    },
  },

  // --- Block 2: the rest of lib/, plus commands/ ----------------------------
  // commands/ sequences lib/ calls and returns a Result. It never formats and
  // never touches ink — which is what makes --dry-run fall out for free: the
  // command renders a plan instead of executing one.
  {
    files: ["src/lib/**/*.{ts,tsx}", "src/commands/**/*.{ts,tsx}"],
    ignores: ["src/lib/exec/**", "src/format/**", "src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: SPAWN_PATHS, patterns: [UI_GROUP, ENTRY_POINT_GROUP] },
      ],
    },
  },

  // --- Block 3: format/ is presentation, and pure ---------------------------
  // node:path is allowed: this layer formats paths, not just numbers, and path
  // manipulation touches no I/O. Anything else node: is a smell.
  {
    files: ["src/format/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: SPAWN_PATHS,
          patterns: [
            {
              group: ["node:*", "!node:path"],
              message:
                "format/ is pure presentation. node:path is the one exception (no I/O).",
            },
            UI_GROUP,
          ],
        },
      ],
    },
  },

  // --- Block 4: cli/ --------------------------------------------------------
  // `ui/` is the only place with ink. dispatch returns data upward and
  // index.tsx decides who renders it, so `wt ls --json | jq` can never grow
  // escape codes.
  {
    files: ["src/cli/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: SPAWN_PATHS, patterns: [UI_GROUP] },
      ],
    },
  },

  // --- Block 5: index.tsx and ui/ -------------------------------------------
  // The only layer that may import ink; nobody may spawn directly.
  {
    files: ["src/index.tsx", "src/ui/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { paths: SPAWN_PATHS }],
    },
  },

  // --- Ambient process state ------------------------------------------------
  // `--cwd <path>` is only honest if nothing reads process.cwd() behind its
  // back. The environment is read once, in index.tsx, and threaded through.
  // lib/exec/env.ts is the documented exception: building a child's
  // environment is its entire job.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/index.tsx",
      "src/lib/exec/env.ts",
      "src/**/*.test.{ts,tsx}",
      "src/test/**",
    ],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "cwd",
          message:
            "Take the working directory as a parameter; index.tsx reads it once (it is what --cwd overrides).",
        },
        {
          object: "process",
          property: "env",
          message:
            "Take the environment as a parameter; index.tsx reads it once and lib/exec scrubs it.",
        },
      ],
    },
  },

  {
    files: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
);
