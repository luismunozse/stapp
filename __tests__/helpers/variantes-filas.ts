import { expect } from "vitest"
import {
  crearReductor,
  estadoDesdeGrupo,
  etiquetaDeFila,
  filasEnOrden,
  type Fila,
  type GrupoLeido,
  type VarianteLeida,
  type VariantesAccion,
  type VariantesState,
} from "@/lib/variantes-filas"

/** Deterministic ids: id1, id2, ... (another prefix keeps two counters from colliding) */
export const contador = (prefijo = "id") => {
  let n = 0
  return () => `${prefijo}${++n}`
}

export const reductor = () => crearReductor(contador())

function congelar<T>(valor: T): T {
  if (valor && typeof valor === "object" && !Object.isFrozen(valor)) {
    Object.freeze(valor)
    Object.values(valor).forEach(congelar)
  }
  return valor
}

/** G4: nothing local to the browser (File, Blob, blob: or data: URLs) can live in the state. */
export function sinContenidoLocal(estado: unknown) {
  const visitar = (v: unknown) => {
    if (typeof File !== "undefined") expect(v).not.toBeInstanceOf(File)
    if (typeof Blob !== "undefined") expect(v).not.toBeInstanceOf(Blob)
    if (v && typeof v === "object") Object.values(v).forEach(visitar)
  }
  visitar(estado)
  const texto = JSON.stringify(estado)
  expect(texto).not.toContain("blob:")
  expect(texto).not.toContain("data:image")
}

/**
 * Applies actions one by one. The input of every step is deep-frozen (a reducer that mutates
 * its state throws) and the result is scanned for local content (G4).
 */
export function aplicar(
  reducir: (estado: VariantesState, accion: VariantesAccion) => VariantesState,
  estado: VariantesState,
  ...acciones: VariantesAccion[]
): VariantesState {
  return acciones.reduce((actual, accion) => {
    const siguiente = reducir(congelar(actual), accion)
    sinContenidoLocal(siguiente)
    return siguiente
  }, estado)
}

export const opcionId = (e: VariantesState, nombre: string) => {
  const o = e.opciones.find((x) => x.nombre === nombre)
  if (!o) throw new Error(`no option ${nombre}`)
  return o.id
}

export const valorId = (e: VariantesState, opcion: string, texto: string) => {
  const v = e.opciones.find((x) => x.nombre === opcion)?.valores.find((x) => x.texto === texto)
  if (!v) throw new Error(`no value ${opcion}/${texto}`)
  return v.id
}

export const etiquetas = (e: VariantesState) => filasEnOrden(e).map((f) => etiquetaDeFila(e, f))

/** The row whose label is exactly `etiqueta` ("Rojo / M"). */
export const filaDe = (e: VariantesState, etiqueta: string): Fila => {
  const f = filasEnOrden(e).find((x) => etiquetaDeFila(e, x) === etiqueta)
  if (!f) throw new Error(`no row ${etiqueta}; have ${etiquetas(e).join(", ")}`)
  return f
}

export const leida = (id: string, atributos: { opcion: string; valor: string }[], over: Partial<VarianteLeida> = {}): VarianteLeida => ({
  id,
  atributos,
  codigo: `FX-${id.toUpperCase()}`,
  barcode: null,
  precioVenta: 1000,
  precioCompra: 400,
  stock: 0,
  stockReservado: 0,
  stockMinimo: null,
  stockMaximo: null,
  puntoReorden: null,
  ubicacion: null,
  imagenUrl: null,
  ...over,
})

const color = (valor: string) => ({ opcion: "Color", valor })
const talle = (valor: string) => ({ opcion: "Talle", valor })

/** Color {Rojo, Azul}: Rojo has 5 units, Azul 3; an archived Verde with 7. */
export const grupoColor = (over: Partial<GrupoLeido> = {}): GrupoLeido => ({
  grupo: { id: "g1", nombre: "Funda X", opciones: [{ nombre: "Color", valores: ["Rojo", "Azul"] }] },
  variantes: [leida("r1", [color("Rojo")], { stock: 5 }), leida("a1", [color("Azul")], { stock: 3 })],
  archivadas: [{ id: "v1", atributos: [color("Verde")], stock: 7 }],
  ...over,
})

/** Color {Rojo, Azul} x Talle {S, M}: four saved rows, ids r-s, r-m, a-s, a-m. */
export const grupoColorTalle = (over: Partial<GrupoLeido> = {}): GrupoLeido => ({
  grupo: {
    id: "g1",
    nombre: "Funda X",
    opciones: [
      { nombre: "Color", valores: ["Rojo", "Azul"] },
      { nombre: "Talle", valores: ["S", "M"] },
    ],
  },
  variantes: [
    leida("r-s", [color("Rojo"), talle("S")], { stock: 1 }),
    leida("r-m", [color("Rojo"), talle("M")], { stock: 2 }),
    leida("a-s", [color("Azul"), talle("S")], { stock: 3 }),
    leida("a-m", [color("Azul"), talle("M")], { stock: 4 }),
  ],
  archivadas: [],
  ...over,
})

export const hidratar = (lectura: GrupoLeido, opciones: { costoCargado?: boolean; codigoBase?: string; precioBase?: number } = {}) =>
  estadoDesdeGrupo(lectura, { costoCargado: true, codigoBase: "FX", precioBase: 1000, ...opciones }, contador("h"))
