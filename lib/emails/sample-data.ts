/**
 * Datos de ejemplo compartidos para previews/test-sends de templates de email.
 */

export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"

export const EMAIL_SAMPLE_DATA = {
  nombre: "Juan Perez",
  organizacion: "TecnoFix Argentina",
  slug: "tecnofix",
  diasRestantes: 5,
  accountAgeDays: 30,
  milestone: { tipo: "ordenes", valor: 100 },
  appUrl: `https://tecnofix.${ROOT_DOMAIN}`,
  reactivarUrl: `https://tecnofix.${ROOT_DOMAIN}/reactivar`,
  billingUrl: `https://tecnofix.${ROOT_DOMAIN}/configuracion/billing`,
}

// Tipos cuyo fallback hardcoded vive en lib/emails/lifecycle-templates.ts
export const LIFECYCLE_TEMPLATE_TYPES = new Set<string>([
  "WELCOME",
  "TIP_DAY_3",
  "TIP_DAY_7",
  "TIP_DAY_14",
  "TRIAL_EXPIRING_5",
  "TRIAL_EXPIRING_1",
  "TRIAL_EXPIRED",
  "TRIAL_AUTO_EXTENDED",
  "TRIAL_LAST_CHANCE",
  "WIN_BACK_7",
  "WIN_BACK_30",
  "MILESTONE",
])

/**
 * Interpolación simple {{var}} y {{a.b}}.
 */
export function interpolateSample(input: string, data: Record<string, unknown> = EMAIL_SAMPLE_DATA): string {
  return input.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const parts = key.split(".")
    let cur: unknown = data
    for (const p of parts) {
      if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p]
      } else return ""
    }
    return cur == null ? "" : String(cur)
  })
}
