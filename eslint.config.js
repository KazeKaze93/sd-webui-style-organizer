import globals from "globals";

const browserGlobals = {
  ...globals.browser,
  gradioApp: "readonly",
  onUiLoaded: "readonly",
  onUiUpdate: "readonly",
  onUiTabChange: "readonly",
};

const jsRules = {
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
};

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    files: [
      "javascript/sg_prompt_utils.js",
      "javascript/style_grid.mjs",
      "javascript/style_grid/**/*.js",
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: browserGlobals,
    },
    rules: jsRules,
  },
];
