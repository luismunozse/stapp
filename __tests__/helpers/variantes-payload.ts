// Payload builders shared by the tests of lib/variantes-schema.ts and lib/variantes-api.ts.
// A valid body of PUT /api/inventario/grupos/[id] and small variations of it.

export type Payload = Record<string, any>

export const ID = (n: number) => `cdead${String(n).padStart(20, "0")}`
export const NBSP = String.fromCharCode(0xa0)
export const SEP = String.fromCharCode(31)
export const EMOJI = String.fromCodePoint(0x1f600)
export const NOMBRES = ["Color", "Talle", "Modelo", "Extra"]

export const fila = (n: number, valores: string[], extra: Payload = {}): Payload => ({
  id: ID(n),
  atributos: valores.map((valor, i) => ({ opcion: NOMBRES[i], valor })),
  codigo: `FX-${n}`,
  ...extra,
})

/** A group with one option per entry of `valoresPorOpcion` and the full cross product of rows. */
export function conOpciones(valoresPorOpcion: string[][]): Payload {
  const combos = valoresPorOpcion.reduce<string[][]>(
    (acc, valores) => acc.flatMap((previo) => valores.map((v) => [...previo, v])),
    [[]]
  )
  return {
    grupo: { nombre: "Funda X", opciones: valoresPorOpcion.map((valores, i) => ({ nombre: NOMBRES[i], valores })) },
    variantes: combos.map((c, i) => fila(i + 1, c)),
  }
}

export const base = (): Payload => conOpciones([["Rojo", "Azul"]])
export const conFila = (i: number, extra: Payload): Payload => {
  const p = base()
  p.variantes[i] = { ...p.variantes[i], ...extra }
  return p
}
export const conGrupo = (extra: Payload): Payload => ({ ...base(), grupo: { ...base().grupo, ...extra } })
export const rango = (n: number, prefijo = "V") => Array.from({ length: n }, (_, i) => `${prefijo}${i + 1}`)
