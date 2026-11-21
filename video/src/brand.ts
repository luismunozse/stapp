// Identidad de STApp, tomada del código de la app (solo tema claro).
// Los HSL vienen de app/globals.css (:root); los estados, de lib/estado-orden-ui.ts.
export const C = {
  bg: 'hsl(214 24% 97%)', // --background (app/globals.css :root)
  card: 'hsl(0 0% 100%)', // --card
  fg: 'hsl(222.2 84% 4.9%)', // --foreground
  muted: 'hsl(215 19% 41%)', // --muted-foreground
  mutedBg: 'hsl(214 20% 94%)', // --muted
  border: 'hsl(214 25% 88%)', // --border (app/globals.css:158)
  primary: 'hsl(221.2 83.2% 53.3%)', // --primary
  primary50: 'hsl(214 100% 97%)', // --primary-50
  primary100: 'hsl(214 95% 93%)', // --primary-100
  primary700: 'hsl(224 76% 48%)', // --primary-700
  primaryFg: 'hsl(210 40% 98%)', // --primary-foreground
  success: 'hsl(142 76% 36%)', // --success
  success50: 'hsl(138 76% 97%)', // --success-50
  success100: 'hsl(141 84% 93%)', // --success-100
  successText: 'hsl(142 72% 27%)', // --success-text
  warning: 'hsl(38 92% 50%)', // --warning
  destructive: 'hsl(0 84.2% 60.2%)', // --destructive
  destructiveText: 'hsl(0 74% 42%)', // --destructive-text
  estadoReparado: '#06b6d4', // REPARADO chartColor (lib/estado-orden-ui.ts)
};
// Inter: app/layout.tsx (next/font/google)
export const FONT = 'Inter, sans-serif';
// --ease-in-out / --ease-out de app/globals.css
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const RADIUS = 24; // tarjetas: rounded-xl escalado al video
export const SHADOW = '0 30px 60px -20px rgb(15 23 42 / 0.25), 0 10px 25px -5px rgb(0 0 0 / 0.08)';
