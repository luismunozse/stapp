/**
 * Definición centralizada de cron jobs.
 * Usado por: cron-panel.tsx (dashboard) y run-cron/route.ts (API).
 */
/**
 * Hora LOCAL de cada organización a la que salen los recordatorios de retiro.
 * El cron corre cada hora (UTC, como todos los cron de Vercel) y sólo procesa
 * las orgs cuya hora local coincide con este valor. Antes corría una única vez
 * a las 10:00 UTC para todas, lo que en UTC-6 (Costa Rica, Guatemala,
 * Nicaragua) caía 04:00 de la madrugada.
 */
export const HORA_RECORDATORIOS_LOCAL = 10

export interface CronJobDefinition {
  id: string
  name: string
  path: string
  schedule: string
  description: string
}

export const CRON_JOBS: CronJobDefinition[] = [
  {
    id: "engagement",
    name: "Engagement",
    path: "/api/cron/engagement",
    schedule: "2:00 AM",
    description: "Calcula engagement score diario por taller",
  },
  {
    id: "feature-usage",
    name: "Feature Usage",
    path: "/api/cron/feature-usage",
    schedule: "3:00 AM",
    description: "Calcula adopción de features por taller",
  },
  {
    id: "trial-management",
    name: "Trial Management",
    path: "/api/cron/trial-management",
    schedule: "8:00 AM",
    description: "Auto-extiende trials y envía emails",
  },
  {
    id: "recordatorios",
    name: "Recordatorios",
    path: "/api/cron/recordatorios",
    schedule: "10:00 AM (hora local de cada taller)",
    description: "Recuerda a clientes retirar equipos",
  },
  {
    id: "lifecycle-emails",
    name: "Lifecycle Emails",
    path: "/api/cron/lifecycle-emails",
    schedule: "11:00 AM",
    description: "Welcome, tips, trial expiring, win-back",
  },
  {
    id: "subscription-sweep",
    name: "Subscription Sweep",
    path: "/api/cron/subscription-sweep",
    schedule: "6:00 AM",
    description: "Downgradea MANUAL vencidas y marca externas PAST_DUE",
  },
  {
    id: "whatsapp-health",
    name: "WhatsApp Health",
    path: "/api/cron/whatsapp-health",
    schedule: "Cada hora",
    description: "Refresca el estado real de las instancias y alerta si se caen",
  },
  {
    id: "catalogo-pii-purge",
    name: "Catálogo PII Purge",
    path: "/api/cron/catalogo-pii-purge",
    schedule: "4:00 AM",
    description: "Borra carritos abandonados y views viejos (Ley 25.326)",
  },
]

/** Paths válidos para el endpoint run-cron */
export const VALID_CRON_PATHS = new Set(CRON_JOBS.map((j) => j.path))
