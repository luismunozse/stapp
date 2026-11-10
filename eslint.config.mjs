import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    // Los worktrees son checkouts completos de la app: sin ignorarlos, `eslint .`
    // desde la raiz lintea el proyecto entero una vez por worktree y en la
    // practica nunca termina. Cada worktree se lintea a si mismo cuando se corre
    // el script desde adentro.
    ignores: [
      "android/**",
      ".worktrees/**",
      ".claude/worktrees/**",
      "playwright-report/**",
      "test-results/**",
    ],
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
      // Reglas que eslint-plugin-react-hooks 7.1 (via eslint-config-next 16.4)
      // promovio a error. Quedan en warn como el resto del React Compiler
      // hasta corregir los casos existentes (comisiones-view, use-form-draft,
      // use-optimistic-mutation, webhook-events-card, devolucion-form).
      "react-hooks/refs": "warn",
      "react-hooks/use-memo": "warn",
      "react/no-unescaped-entities": "warn",
      "import/no-anonymous-default-export": "warn",
    },
  },
];

export default eslintConfig;
