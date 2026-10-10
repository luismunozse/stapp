// Pestañas de /configuracion. Vive fuera del componente cliente para que la
// página (server) pueda validar `?tab=` sin importar desde un módulo "use client".
export const CONFIG_TABS = [
  { value: "secciones", label: "Secciones" },
  { value: "empresa", label: "Empresa" },
  { value: "facturacion", label: "Facturación" },
  { value: "comprobantes", label: "Comprobantes" },
  { value: "avisos", label: "Avisos" },
  { value: "seguridad", label: "Seguridad" },
] as const

export type ConfigTab = (typeof CONFIG_TABS)[number]["value"]

export const DEFAULT_CONFIG_TAB: ConfigTab = "secciones"

// Solo estas pestañas guardan el formulario con la barra inferior. Avisos se
// guarda por separado (NotificationSettings) y Secciones/Seguridad no guardan.
export const FORM_TABS: readonly ConfigTab[] = ["empresa", "facturacion", "comprobantes"]

export function parseConfigTab(value: string | string[] | undefined | null): ConfigTab {
  const raw = Array.isArray(value) ? value[0] : value
  // Links viejos: "Módulos opcionales" ahora vive en Empresa.
  if (raw === "modulos") return "empresa"
  return CONFIG_TABS.find((tab) => tab.value === raw)?.value ?? DEFAULT_CONFIG_TAB
}
