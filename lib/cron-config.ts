/**
 * Definición centralizada de cron jobs.
 * Usado por: cron-panel.tsx (dashboard) y run-cron/route.ts (API).
 */
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
    schedule: "10:00 AM",
    description: "Recuerda a clientes retirar equipos",
  },
  {
    id: "lifecycle-emails",
    name: "Lifecycle Emails",
    path: "/api/cron/lifecycle-emails",
    schedule: "11:00 AM",
    description: "Welcome, tips, trial expiring, win-back",
  },
]

/** Paths válidos para el endpoint run-cron */
export const VALID_CRON_PATHS = new Set(CRON_JOBS.map((j) => j.path))
