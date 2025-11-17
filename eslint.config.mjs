import ts from "@typescript-eslint/eslint-plugin";
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import astroParser from "astro-eslint-parser";
import astro from "eslint-plugin-astro";
import globals from "globals";
import jsdoc from "eslint-plugin-jsdoc";
import importPlugin from "eslint-plugin-import";

export default [
  // Lint .astro files
  {
    files: ["**/*.astro"],
    languageOptions: {
      parser: astroParser,
      parserOptions: {
        parser: tsParser,
        extraFileExtensions: [".astro"],
      },
    },
    plugins: {
      astro,
    },
    rules: {
      ...astro.configs.recommended.rules,
    },
  },

  // Lint JS files (browser)
  {
    files: ["**/*.{js,jsx}"],
    ignores: ["src/pages/api/**/*.js"],
    languageOptions: {
      parserOptions: {
        sourceType: "module",
        ecmaVersion: "latest",
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },

  // Lint JS API routes (Node environment)
  {
    files: ["src/pages/api/**/*.js"],
    languageOptions: {
      parserOptions: {
        sourceType: "module",
        ecmaVersion: "latest",
      },
      globals: {
        ...globals.node,
        Response: "readonly",
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-console": "off",
    },
  },

  // Lint TS files
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
        ecmaVersion: "latest",
      },
    },
    plugins: {
      "@typescript-eslint": ts,
      jsdoc: jsdoc,
      import: importPlugin,
    },
    rules: {
      ...ts.configs.recommended.rules,
      // Remove prettierRecommended.rules
      "@typescript-eslint/explicit-function-return-type": ["error", { allowExpressions: false }],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "jsdoc/require-jsdoc": [
        "warn",
        {
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
            ArrowFunctionExpression: true,
            FunctionExpression: true,
          },
        },
      ],
      "jsdoc/require-param": "warn",
      "jsdoc/require-returns": "warn",
      "import/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          "newlines-between": "always",
        },
      ],
      "import/no-duplicates": "error",
      "import/newline-after-import": "warn",
      "import/no-useless-path-segments": "warn",
      "no-undef": "off",
    },
  },

  // Config files (less strict)
  {
    files: ["*.config.{js,ts,mjs}", "*.setup.{js,ts}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-var-requires": "off",
    },
  },
];