import nextConfig from "eslint-config-next";

// Piso tipográfico de 12 px (auditoría UX §2.3): text-[8px]…text-[11px] y los
// equivalentes en rem (< 0.75rem) no se leen bien en el mostrador ni en el
// celular. Se usa `text-xs` (12 px) o `.text-caption-mobile`.
const TEXTO_CHICO = /(?:^|[\s"'`:])text-\[(?:(?:[0-9]|1[01])(?:\.\d+)?px|0?\.(?:[0-6]\d*|7(?:[0-4]\d*)?)rem)\]/;

const stappPlugin = {
  rules: {
    "texto-minimo-12px": {
      meta: {
        type: "suggestion",
        docs: { description: "Prohíbe clases de texto menores a 12 px" },
        messages: {
          chico:
            "Texto menor a 12 px ({{clase}}). Usá `text-xs` (12 px) o `.text-caption-mobile`; si el chip no entra, ajustá el layout (truncate, leading-none) en vez de achicar la letra.",
        },
        schema: [],
      },
      create(context) {
        const revisar = (node, texto) => {
          if (typeof texto !== "string") return;
          const m = texto.match(TEXTO_CHICO);
          if (m) {
            context.report({ node, messageId: "chico", data: { clase: m[0].replace(/^[\s"'`:]/, "") } });
          }
        };
        return {
          Literal: (node) => revisar(node, node.value),
          TemplateElement: (node) => revisar(node, node.value.raw),
        };
      },
    },
  },
};

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
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"],
    // Tickets térmicos: se imprimen en papel de 58/80 mm, no son texto de pantalla.
    ignores: ["components/ordenes/thermal-print-*.tsx", "**/__tests__/**", "**/*.test.{ts,tsx}"],
    plugins: { stapp: stappPlugin },
    rules: {
      "stapp/texto-minimo-12px": "error",
    },
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
