import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: ["android/**"],
  },
  {
    // Playwright fixtures receive a `use` callback parameter (test.extend API);
    // the react-hooks rule misreads those calls as React hook violations.
    files: ["e2e/**"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "react/no-unescaped-entities": "warn",
      "import/no-anonymous-default-export": "warn",
    },
  },
];

export default eslintConfig;
