import globals from "globals";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    files: ["javascript/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        gradioApp: "readonly",
        onUiLoaded: "readonly",
        onUiUpdate: "readonly",
        onUiTabChange: "readonly",
      },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-undef": "warn",
      eqeqeq: "error",
      "no-duplicate-case": "error",
      "no-unreachable": "error",
    },
  },
];
