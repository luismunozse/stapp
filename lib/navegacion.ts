import {
  LayoutDashboard,
  ClipboardList,
  Users,
  Wrench,
  Hammer,
  Package,
  FileMinus,
  FileText,
  BarChart3,
  Settings,
  Store,
  TrendingUp,
  ShoppingCart,
  Headset,
  Receipt,
  Landmark,
  Mail,
  Wallet,
  Truck,
  Percent,
  BookMarked,
  CalendarDays,
  ShieldCheck,
  Plus,
  UserPlus,
  type LucideIcon,
} from "lucide-react"

/**
 * Fuente única de la navegación del panel: el sidebar de escritorio, el menú
 * mobile, la barra inferior y la paleta de comandos salen de acá. Un ítem nuevo
 * se agrega una sola vez y hereda el mismo filtro por rol y por módulo.
 */

export type OrgFeatures = {
  moduloAgenda: boolean
  vendedoresAdministranInventario: boolean
  tecnicosOperanPos: boolean
  vendedoresManejanCaja: boolean
}

export const ORG_FEATURES_APAGADAS: OrgFeatures = {
  moduloAgenda: false,
  vendedoresAdministranInventario: false,
  tecnicosOperanPos: false,
  vendedoresManejanCaja: false,
}

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  /** undefined = visible para todos los roles. */
  roles?: string[]
  /** Módulo de la org: si está apagado, el ítem no aparece para nadie. */
  featureFlag?: "moduloAgenda"
  /** Le saca el ítem al VENDEDOR salvo que la org lo habilite. */
  vendedorFeatureFlag?: "vendedoresAdministranInventario" | "vendedoresManejanCaja"
  /** Le agrega el ítem al TECNICO (que no está en `roles`) si la org lo habilita. */
  tecnicoFeatureFlag?: "tecnicosOperanPos"
  /** Palabras extra para encontrarlo en la paleta de comandos. */
  keywords?: string[]
}

export type NavSection = { label: string; items: NavItem[] }

// Primer nivel sin título (lo de todos los días) y secciones colapsables.
// Ningún título de sección repite el nombre de un ítem.
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "",
    items: [
      { href: "/dashboard", label: "Inicio", icon: LayoutDashboard, keywords: ["dashboard", "panel", "resumen"] },
      { href: "/ordenes", label: "Órdenes", icon: ClipboardList, keywords: ["reparaciones", "equipos"] },
      { href: "/agenda", label: "Agenda", icon: CalendarDays, featureFlag: "moduloAgenda", keywords: ["turnos"] },
      { href: "/clientes", label: "Clientes", icon: Users, roles: ["ADMIN", "VENDEDOR", "TECNICO"] },
      { href: "/garantias", label: "Garantías", icon: ShieldCheck, roles: ["ADMIN", "VENDEDOR", "TECNICO"] },
      { href: "/inventario", label: "Inventario", icon: Package, roles: ["ADMIN", "VENDEDOR"], vendedorFeatureFlag: "vendedoresAdministranInventario", keywords: ["stock", "repuestos", "productos"] },
      { href: "/servicios", label: "Servicios", icon: Hammer, roles: ["ADMIN"] },
    ],
  },
  {
    label: "Comercial",
    items: [
      { href: "/ventas", label: "Ventas", icon: ShoppingCart, roles: ["ADMIN", "VENDEDOR"], tecnicoFeatureFlag: "tecnicosOperanPos", keywords: ["devoluciones"] },
      { href: "/pos", label: "POS", icon: Store, roles: ["ADMIN", "VENDEDOR"], tecnicoFeatureFlag: "tecnicosOperanPos", keywords: ["punto de venta", "mostrador", "vender"] },
      { href: "/cotizaciones", label: "Presupuestos", icon: Receipt, roles: ["ADMIN", "TECNICO"], keywords: ["cotizaciones", "presupuestos"] },
      { href: "/catalogo", label: "Catálogo público", icon: BookMarked, roles: ["ADMIN"], keywords: ["tienda", "e-commerce"] },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { href: "/finanzas", label: "Resumen financiero", icon: Wallet, roles: ["ADMIN"], keywords: ["finanzas", "gastos", "ganancia", "rentabilidad"] },
      { href: "/caja", label: "Caja", icon: Landmark, roles: ["ADMIN", "VENDEDOR"], vendedorFeatureFlag: "vendedoresManejanCaja", keywords: ["arqueo", "efectivo"] },
      { href: "/facturacion", label: "Comprobantes", icon: FileText, roles: ["ADMIN"], keywords: ["remitos", "pagos", "facturas", "arca", "afip"] },
      { href: "/notas-credito", label: "Notas de crédito", icon: FileMinus, roles: ["ADMIN"] },
      { href: "/reportes", label: "Reportes", icon: BarChart3, roles: ["ADMIN", "VENDEDOR"], keywords: ["estadísticas"] },
    ],
  },
  {
    label: "Más",
    items: [
      { href: "/tecnicos", label: "Técnicos", icon: Wrench, roles: ["ADMIN"] },
      { href: "/tecnicos", label: "Mi desempeño", icon: TrendingUp, roles: ["TECNICO"] },
      { href: "/comisiones", label: "Comisiones", icon: Percent, roles: ["ADMIN"] },
      { href: "/vendedores", label: "Vendedores", icon: TrendingUp, roles: ["ADMIN"] },
      { href: "/ordenes-compra", label: "Compras", icon: Truck, roles: ["ADMIN"], keywords: ["órdenes de compra"] },
      { href: "/proveedores", label: "Proveedores", icon: Store, roles: ["ADMIN", "VENDEDOR"] },
      { href: "/emails", label: "Emails", icon: Mail, roles: ["ADMIN"] },
      { href: "/soporte", label: "Soporte", icon: Headset, keywords: ["ayuda"] },
      { href: "/configuracion", label: "Configuración", icon: Settings, roles: ["ADMIN"], keywords: ["ajustes", "iva", "arca"] },
    ],
  },
]

/**
 * Acciones de la paleta de comandos. Usan el mismo filtro que la navegación:
 * cada una exige lo mismo que la pantalla a la que lleva.
 */
export const ACCIONES_RAPIDAS: NavItem[] = [
  { href: "/ordenes?nueva=1", label: "Nueva orden", icon: Plus, keywords: ["crear orden", "ingreso", "reparación"] },
  { href: "/pos", label: "Nueva venta", icon: ShoppingCart, roles: ["ADMIN", "VENDEDOR"], tecnicoFeatureFlag: "tecnicosOperanPos", keywords: ["vender", "pos", "punto de venta"] },
  { href: "/clientes?nuevo=1", label: "Nuevo cliente", icon: UserPlus, roles: ["ADMIN", "VENDEDOR", "TECNICO"], keywords: ["crear cliente", "alta"] },
  { href: "/ordenes-compra?nueva=1", label: "Nueva orden de compra", icon: Truck, roles: ["ADMIN"], keywords: ["proveedor", "comprar"] },
]

/** Hrefs de la barra inferior mobile, por rol (sus ítems salen de NAV_SECTIONS). */
export const BOTTOM_NAV_HREFS: Record<string, string[]> = {
  ADMIN: ["/dashboard", "/ordenes", "/clientes", "/inventario"],
  VENDEDOR: ["/dashboard", "/pos", "/ventas", "/clientes", "/inventario"],
  TECNICO: ["/dashboard", "/ordenes", "/agenda", "/clientes"],
}

export function itemVisible(item: NavItem, role: string, features: OrgFeatures): boolean {
  if (item.featureFlag && !features[item.featureFlag]) return false
  // ADMIN siempre ve el módulo; VENDEDOR solo si la org habilitó el flag.
  if (role === "VENDEDOR" && item.vendedorFeatureFlag && !features[item.vendedorFeatureFlag]) return false
  if (!item.roles || item.roles.includes(role)) return true
  // El técnico habilitado ve el POS sin dejar de ser TECNICO.
  return role === "TECNICO" && !!item.tecnicoFeatureFlag && !!features[item.tecnicoFeatureFlag]
}

export function seccionesVisibles(role: string, features: OrgFeatures): NavSection[] {
  return NAV_SECTIONS
    .map((section) => ({ ...section, items: section.items.filter((item) => itemVisible(item, role, features)) }))
    .filter((section) => section.items.length > 0)
}

export function itemsVisibles(role: string, features: OrgFeatures): NavItem[] {
  return seccionesVisibles(role, features).flatMap((section) => section.items)
}

export function accionesVisibles(role: string, features: OrgFeatures): NavItem[] {
  return ACCIONES_RAPIDAS.filter((item) => itemVisible(item, role, features))
}

export function bottomNavItems(role: string, features: OrgFeatures): NavItem[] {
  const visibles = itemsVisibles(role, features)
  const hrefs = BOTTOM_NAV_HREFS[role] ?? BOTTOM_NAV_HREFS.ADMIN
  return hrefs
    .map((href) => visibles.find((item) => item.href === href))
    .filter((item): item is NavItem => !!item)
}

export function esRutaActiva(pathname: string, href: string): boolean {
  const base = href.split("?")[0]
  return pathname === base || pathname.startsWith(base + "/")
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
}

/** ¿El ítem coincide con lo que se tipeó en la paleta? Sin tildes ni mayúsculas. */
export function coincideComando(item: NavItem, query: string): boolean {
  const q = normalizar(query)
  if (!q) return true
  return [item.label, ...(item.keywords ?? [])].some((texto) => normalizar(texto).includes(q))
}

/** Destino de un resultado de búsqueda: siempre la ficha, no el listado. */
export function hrefResultado(tipo: "cliente" | "orden", id: string): string {
  return tipo === "cliente" ? `/clientes/${id}` : `/ordenes/${id}`
}
