import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: ["android/**"],
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
