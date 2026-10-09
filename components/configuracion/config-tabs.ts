// Pestañas de /configuracion. Vive fuera del componente cliente para que la
// página (server) pueda validar `?tab=` sin importar desde un módulo "use client".
export const CONFIG_TABS = [
  { value: "secciones", label: "Secciones" },
  { value: "empresa", label: "Empresa" },
  { value: "facturacion", label: "Facturación" },
  { value: "comprobantes", label: "Comprobantes" },
  { value: "modulos", label: "Módulos y avisos" },
  { value: "seguridad", label: "Seguridad" },
] as const

export type ConfigTab = (typeof CONFIG_TABS)[number]["value"]

export const DEFAULT_CONFIG_TAB: ConfigTab = "secciones"

// Solo estas pestañas guardan el formulario: Secciones y Seguridad no tienen
// nada que guardar con el botón de la barra inferior.
export const FORM_TABS: readonly ConfigTab[] = ["empresa", "facturacion", "comprobantes", "modulos"]

export function parseConfigTab(value: string | string[] | undefined | null): ConfigTab {
  const raw = Array.isArray(value) ? value[0] : value
  return CONFIG_TABS.find((tab) => tab.value === raw)?.value ?? DEFAULT_CONFIG_TAB
}
