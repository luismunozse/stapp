import type { RubroPack, RubroTipo } from "../types"
import type { TipoDispositivoConfig } from "@/types"
import { getTipoBaseConfig } from "@/lib/tipos-dispositivo-defaults"
import { CHECKLIST_PRESETS } from "@/lib/onboarding/checklist-presets"

/**
 * Categorías de inventario por tipo. Los valores replican los que sembró la
 * migración 264 en `tipos_dispositivo.config.categoriasInventario`, que a su vez
 * venían del mapa hardcodeado de `components/inventario/inventario-form.tsx`.
 * Acá quedan del lado del pack para que una org nueva ya nazca con ellas.
 */
const CATEGORIAS: Record<string, string[]> = {
  CELULAR: ["Pantallas", "Protectores", "Baterías", "Fundas", "Cargadores", "Flex", "Módulos", "Otros"],
  COMPUTADORA: ["Pantallas", "Teclados", "Baterías", "Memorias", "Discos", "Cargadores", "Otros"],
  TABLET: ["Pantallas", "Protectores", "Baterías", "Fundas", "Cargadores", "Flex", "Otros"],
  CONSOLA: ["Joysticks", "Fuentes", "Flex", "Lectoras", "Coolers", "Otros"],
  SMARTWATCH: ["Mallas", "Pantallas", "Baterías", "Cargadores", "Otros"],
  IMPRESORA: ["Cartuchos", "Tóners", "Cabezales", "Rodillos", "Fuentes", "Placas", "Otros"],
  ACCESORIOS: ["Auriculares", "Parlantes", "Cables", "Adaptadores", "Cargadores", "Soportes", "Otros"],
  TODOS: ["Pantallas", "Baterías", "Fundas", "Teclados", "Memorias", "Cargadores", "Otros"],
}

/**
 * Los códigos, nombres, prefijos y órdenes son EXACTAMENTE los que sembraba
 * `poblar_tipos_dispositivo_base()` (migraciones 014 → 021 → 092). Cambiarlos
 * haría que una org nueva arranque distinta a las que ya están en producción.
 */
const TIPOS_BASE: Array<Omit<RubroTipo, "config">> = [
  { codigo: "CELULAR", nombre: "Celular", prefijoOrden: "CEL", icono: "Smartphone", orden: 1 },
  { codigo: "COMPUTADORA", nombre: "Computadora", prefijoOrden: "PC", icono: "Monitor", orden: 2 },
  { codigo: "TABLET", nombre: "Tablet", prefijoOrden: "TAB", icono: "Tablet", orden: 3 },
  { codigo: "CONSOLA", nombre: "Consola", prefijoOrden: "CONS", icono: "Gamepad2", orden: 4 },
  { codigo: "SMARTWATCH", nombre: "Smartwatch", prefijoOrden: "SW", icono: "Watch", orden: 5 },
  { codigo: "ACCESORIOS", nombre: "Accesorios", prefijoOrden: "ACC", icono: "Headphones", orden: 6 },
  { codigo: "IMPRESORA", nombre: "Impresora", prefijoOrden: "IMP", icono: "Printer", orden: 7 },
  { codigo: "TODOS", nombre: "Todos los dispositivos", prefijoOrden: "ORD", icono: "Package", orden: 99 },
]

function conConfig(tipo: Omit<RubroTipo, "config">): RubroTipo {
  const base = getTipoBaseConfig(tipo.codigo) as TipoDispositivoConfig
  return {
    ...tipo,
    config: {
      ...base,
      categoriasInventario: CATEGORIAS[tipo.codigo] ?? CATEGORIAS.TODOS,
    },
  }
}

export const electronica: RubroPack = {
  id: "electronica",
  nombre: "Electrónica y computación",
  descripcion: "Celulares, computadoras, tablets, consolas, impresoras y accesorios.",
  icono: "Smartphone",

  // Vacío a propósito: los defaults neutrales de lib/terminologia.ts
  // ("Equipo", "Orden de trabajo", "Número de serie") ya sirven para este rubro,
  // y es lo que ven hoy todas las orgs en producción.
  terminologia: {},

  tipos: TIPOS_BASE.map(conConfig),

  // Los presets de electrónica ya existían en lib/onboarding/checklist-presets.ts
  // pero ningún código los instalaba. Acá se conectan al flujo de registro.
  checklists: CHECKLIST_PRESETS.filter(
    (p) => p.tipoDispositivo !== "_GENERICO_ELECTRODOMESTICO"
  ).map((p) => ({
    nombre: p.nombre,
    tipoCodigo: p.tipoDispositivo,
    items: p.items,
  })),
}
