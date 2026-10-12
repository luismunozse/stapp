// Shared vectors for the variant key and name functions (G3). The SQL functions
// (inventario_combinacion_clave / inventario_nombre_variante) and their JS twins in
// lib/variantes.ts must agree on every row. The probes file carries the same rows
// between `-- VECTORS:BEGIN` / `-- VECTORS:END` and executes them on the real DB.
//
// The key folds case, surrounding spaces and the accents of the translate map
// 'áàäâéèëêíìïîóòöôúùüû'. It does NOT use normalize("NFD"): that would turn ñ into n,
// and SQL keeps ñ distinct.

/** `a` and `b` are the option values of one combination, in option order. */
export interface KeyVector {
  a: string[]
  b: string[]
  same: boolean
}

export interface NameVector {
  base: string
  values: string[]
  expected: string
}

export const KEY_VECTORS: KeyVector[] = [
  { a: ["Rojo"], b: ["rojo"], same: true },
  { a: ["Rojo"], b: ["Rojó"], same: true },
  { a: ["Rojo"], b: ["ROJÓ"], same: true },
  { a: [" Rojo "], b: ["rojo"], same: true },
  { a: ["Rojo", "M"], b: ["rojó", "m"], same: true },
  { a: ["Ñandú"], b: ["ñandu"], same: true },
  { a: ["Año"], b: ["Ano"], same: false },
  { a: ["Rojo"], b: ["Rosado"], same: false },
  { a: ["Rojo", "M"], b: ["M", "Rojo"], same: false },
  { a: ["a b"], b: ["a", "b"], same: false },
]

export const NAME_VECTORS: NameVector[] = [
  { base: "Funda X", values: ["Azul", "M"], expected: "Funda X - Azul / M" },
  { base: "Funda X", values: ["Azul"], expected: "Funda X - Azul" },
  { base: "Funda X", values: ["Azul", "M", "2"], expected: "Funda X - Azul / M / 2" },
  { base: "Funda - X", values: ["Azul", "M"], expected: "Funda - X - Azul / M" },
  { base: "Cámara", values: ["Rojó"], expected: "Cámara - Rojó" },
  { base: "Funda X", values: [], expected: "Funda X" },
]
