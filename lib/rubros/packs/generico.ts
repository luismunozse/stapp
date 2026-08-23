import type { RubroPack } from "../types"

/**
 * Pack neutral. Es el fallback cuando la org no eligió rubro (o eligió uno que
 * ya no existe en el registro) y también la opción explícita para oficios que
 * todavía no tienen pack propio.
 *
 * A propósito deja el vocabulario en los defaults del sistema y no impone
 * problemas comunes ni categorías: es preferible que el usuario los cargue a
 * que arranque con contenido de otro rubro.
 */
export const generico: RubroPack = {
  id: "generico",
  nombre: "Otro servicio técnico",
  descripcion: "Arrancá con una base neutral y configurá los tipos de equipo a tu medida.",
  icono: "Wrench",

  terminologia: {},

  tipos: [
    {
      codigo: "EQUIPO",
      nombre: "Equipo",
      prefijoOrden: "EQ",
      icono: "Package",
      orden: 1,
      config: {
        campos: {
          imei: { visible: true, label: "Número de serie", placeholder: "S/N del equipo" },
          password: { visible: false },
          color: { visible: true },
          marca: { visible: true },
        },
        camposExtra: [],
        accesorios: [
          { id: "cable_poder", label: "Cable de alimentación" },
          { id: "manual", label: "Manual" },
          { id: "caja_original", label: "Caja original" },
          { id: "accesorios_originales", label: "Accesorios originales" },
        ],
        problemasComunes: [],
        marcas: [],
        categoriasInventario: ["Repuestos", "Insumos", "Accesorios", "Otros"],
      },
    },
  ],

  checklists: [
    {
      nombre: "Recepción",
      tipoCodigo: null,
      items: [
        { label: "Estado general al ingresar", tipo: "SELECT", categoria: "CONDICION_FISICA", opciones: "Sin daño,Rayones,Golpes,Roto", orden: 1, requerido: true },
        { label: "Funciona al ingresar", tipo: "BOOLEAN", categoria: "FUNCIONAL", opciones: null, orden: 2, requerido: true },
        { label: "Accesorios entregados", tipo: "TEXT", categoria: "ACCESORIOS", opciones: null, orden: 3, requerido: false },
        { label: "Observaciones adicionales", tipo: "TEXT", categoria: "OTRO", opciones: null, orden: 4, requerido: false },
      ],
    },
  ],
}
