# Calibración de impresora térmica — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perfil de impresora por dispositivo (columnas, code page, corte) calibrado por un wizard que imprime tests físicos, para que órdenes y POS impriman bien en cualquier impresora térmica.

**Architecture:** `lib/thermal-paper.ts` pasa de guardar solo el ancho a un `PrinterProfile` en localStorage (con migración desde las dos claves legacy). `lib/escpos.ts` se parametriza por perfil (4 codepages, 3 variantes de corte, columnas variables). Un wizard nuevo (`components/impresora/`) imprime tests y persiste lo que el usuario elige; la lógica de pasos vive como reducer puro en `lib/printer-calibration.ts` para testearla sin DOM.

**Tech Stack:** Next.js + TypeScript, vitest (`npm run test:run`), Testing Library disponible, WebUSB (hook existente `useThermalPrinter`), shadcn Dialog.

**Spec:** `docs/superpowers/specs/2026-08-03-calibracion-impresora-termica-design.md`

## Global Constraints

- Strict TDD: test que falla → implementación mínima → test verde → commit. Runner: `npm run test:run -- <archivo>` (vitest; `npm test` queda en watch).
- Default del perfil = comportamiento actual (80mm, 48 columnas, cp858, corte `GS V`): cero regresión si el usuario nunca calibra.
- Copy de UI en español neutro/profesional, consistente con la app ("Use...", sin slang). Nombres de código en inglés salvo dominio ya en español (ancho, corte, columnas — seguir el estilo del módulo).
- No tocar: etiquetas (`lib/labels/*`, `print-label.ts`), `thermal-print-recepcion.tsx` (camino navegador puro, no usa el motor ESC/POS).
- Conventional commits, sin atribución de IA.
- Los tests de `__tests__/lib/` que tocan localStorage corren en el env default (jsdom); los de bytes puros llevan `// @vitest-environment node` (patrón existente).
- Presupuesto de PR: el total estimado supera 400 líneas → al terminar la Task 5 se abre PR #1 (motor + perfil + errores) y las Tasks 6-8 van en PR #2 (wizard + entradas) apilado. Ver Task 9.

---

### Task 0: Branch y commit de spec + plan

**Files:** ninguno de código.

- [ ] **Step 1: Verificar branch actual y crear la nueva desde main**

La branch actual es `feat/cobro-en-entrega` (trabajo ajeno en vuelo — no commitear ahí). El spec es un archivo untracked, sobrevive el checkout.

```bash
git branch --show-current
git fetch origin
git checkout -b feat/calibracion-impresora-termica origin/main
```

- [ ] **Step 2: Commitear spec y plan (NO agregar los `.atl/*` modificados ni otros untracked ajenos)**

```bash
git add docs/superpowers/specs/2026-08-03-calibracion-impresora-termica-design.md docs/superpowers/plans/2026-08-03-calibracion-impresora-termica.md
git commit -m "docs: spec y plan de calibracion de impresora termica"
```

---

### Task 1: `PrinterProfile` en `lib/thermal-paper.ts`

**Files:**
- Modify: `lib/thermal-paper.ts`
- Test: `__tests__/lib/thermal-paper.test.ts` (extender)

**Interfaces:**
- Consumes: nada nuevo.
- Produces (las usan Tasks 2-7):
  - `type Codepage = "cp437" | "cp850" | "cp858" | "win1252"`
  - `type Corte = "gsv" | "esci" | "none"`
  - `interface PrinterProfile { ancho: AnchoTermico; columnas: number; codepage: Codepage; corte: Corte }`
  - `defaultProfile(ancho?: AnchoTermico): PrinterProfile`
  - `columnasDefault(a: AnchoTermico): number` (58→32, 80→48)
  - `readProfile(): PrinterProfile` / `saveProfile(p: PrinterProfile): void`
  - `readAncho`/`saveAncho` siguen existiendo (delegan en el perfil; call sites viejos no se rompen).

- [ ] **Step 1: Escribir los tests que fallan** — agregar a `__tests__/lib/thermal-paper.test.ts`:

```ts
import {
  readAncho, saveAncho, anchoToPx, anchoLogoDots, DEFAULT_ANCHO,
  readProfile, saveProfile, defaultProfile, columnasDefault,
} from "@/lib/thermal-paper"

describe("thermal-paper — perfil de impresora", () => {
  beforeEach(() => localStorage.clear())

  it("sin nada guardado devuelve el default (80mm, 48 col, cp858, gsv)", () => {
    expect(readProfile()).toEqual({ ancho: 80, columnas: 48, codepage: "cp858", corte: "gsv" })
  })

  it("roundtrip saveProfile/readProfile", () => {
    const p = { ancho: 80 as const, columnas: 42, codepage: "win1252" as const, corte: "esci" as const }
    saveProfile(p)
    expect(readProfile()).toEqual(p)
  })

  it("migra desde la clave legacy de ordenes (stapp:comprobante-ancho)", () => {
    localStorage.setItem("stapp:comprobante-ancho", "58")
    expect(readProfile()).toEqual(defaultProfile(58))
    expect(readProfile().columnas).toBe(32)
  })

  it("migra desde la clave legacy del POS (pos_printer_width)", () => {
    localStorage.setItem("pos_printer_width", "80")
    expect(readProfile()).toEqual(defaultProfile(80))
  })

  it("el perfil guardado gana sobre las claves legacy", () => {
    localStorage.setItem("pos_printer_width", "58")
    saveProfile({ ancho: 80, columnas: 48, codepage: "cp437", corte: "none" })
    expect(readProfile().codepage).toBe("cp437")
  })

  it("JSON corrupto o valores invalidos caen al default", () => {
    localStorage.setItem("stapp:printer-profile", "{no es json")
    expect(readProfile()).toEqual(defaultProfile())
    localStorage.setItem("stapp:printer-profile", JSON.stringify({ ancho: 70, columnas: 99, codepage: "utf8", corte: "laser" }))
    expect(readProfile()).toEqual(defaultProfile())
  })

  it("saveAncho cambia ancho y resetea columnas al default, pero conserva codepage y corte", () => {
    saveProfile({ ancho: 80, columnas: 42, codepage: "win1252", corte: "esci" })
    saveAncho(58)
    expect(readProfile()).toEqual({ ancho: 58, columnas: 32, codepage: "win1252", corte: "esci" })
  })

  it("readAncho delega en el perfil", () => {
    saveProfile({ ancho: 58, columnas: 32, codepage: "cp858", corte: "gsv" })
    expect(readAncho()).toBe(58)
  })

  it("columnasDefault: 58→32, 80→48", () => {
    expect(columnasDefault(58)).toBe(32)
    expect(columnasDefault(80)).toBe(48)
  })
})
```

Los 3 tests existentes de "persistencia del ancho" deben seguir verdes tal cual (la migración legacy los cubre: `saveAncho(58)` + `readAncho()` roundtrip ahora pasa por el perfil).

- [ ] **Step 2: Correr y ver fallar**

Run: `npm run test:run -- __tests__/lib/thermal-paper.test.ts`
Expected: FAIL — `readProfile is not exported`.

- [ ] **Step 3: Implementar** — reemplazar la parte de storage de `lib/thermal-paper.ts` (conservar `AnchoTermico`, `ANCHOS_TERMICOS`, `DEFAULT_ANCHO`, `anchoToPx`, `anchoLogoDots` tal cual):

```ts
export type Codepage = "cp437" | "cp850" | "cp858" | "win1252"
export type Corte = "gsv" | "esci" | "none"

export interface PrinterProfile {
  ancho: AnchoTermico
  columnas: number
  codepage: Codepage
  corte: Corte
}

const PROFILE_KEY = "stapp:printer-profile"
// Claves previas al perfil; se migran en la primera lectura.
const LEGACY_ANCHO_KEY = "stapp:comprobante-ancho" // ordenes
const LEGACY_POS_KEY = "pos_printer_width" // POS

export function columnasDefault(a: AnchoTermico): number {
  return a === 58 ? 32 : 48
}

export function defaultProfile(ancho: AnchoTermico = DEFAULT_ANCHO): PrinterProfile {
  return { ancho, columnas: columnasDefault(ancho), codepage: "cp858", corte: "gsv" }
}

const CODEPAGES: Codepage[] = ["cp437", "cp850", "cp858", "win1252"]
const CORTES: Corte[] = ["gsv", "esci", "none"]

function isValidProfile(p: unknown): p is PrinterProfile {
  if (typeof p !== "object" || p === null) return false
  const q = p as Record<string, unknown>
  return (
    (q.ancho === 58 || q.ancho === 80) &&
    (q.columnas === 32 || q.columnas === 42 || q.columnas === 48) &&
    CODEPAGES.includes(q.codepage as Codepage) &&
    CORTES.includes(q.corte as Corte)
  )
}

export function readProfile(): PrinterProfile {
  if (typeof window === "undefined") return defaultProfile()
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY)
    if (raw) {
      const p: unknown = JSON.parse(raw)
      return isValidProfile(p) ? p : defaultProfile()
    }
    const legacy =
      window.localStorage.getItem(LEGACY_ANCHO_KEY) ??
      window.localStorage.getItem(LEGACY_POS_KEY)
    const n = parseInt(legacy ?? "", 10)
    return n === 58 || n === 80 ? defaultProfile(n) : defaultProfile()
  } catch {
    return defaultProfile()
  }
}

export function saveProfile(p: PrinterProfile): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
  } catch {
    /* localStorage no disponible (modo privado, etc.) */
  }
}

/** Ancho recordado por dispositivo (compat: delega en el perfil). */
export function readAncho(): AnchoTermico {
  return readProfile().ancho
}

/** Cambiar el ancho resetea columnas a su default; codepage y corte se conservan. */
export function saveAncho(a: AnchoTermico): void {
  const p = readProfile()
  saveProfile({ ...p, ancho: a, columnas: columnasDefault(a) })
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npm run test:run -- __tests__/lib/thermal-paper.test.ts`
Expected: PASS (los 3 describe: viejos y nuevo).

- [ ] **Step 5: Commit**

```bash
git add lib/thermal-paper.ts __tests__/lib/thermal-paper.test.ts
git commit -m "feat(impresora): perfil de impresora por dispositivo con migracion desde claves legacy"
```

---

### Task 2: Codepages, `charsetCommand` y `cutCommands` en `lib/escpos.ts`

**Files:**
- Modify: `lib/escpos.ts` (zona del mapa CP858 y `textToBytes`, líneas ~19-71)
- Test: `__tests__/lib/escpos-codepages.test.ts` (nuevo)

**Interfaces:**
- Consumes: `Codepage`, `Corte` de `@/lib/thermal-paper`.
- Produces (las usan Tasks 3-4):
  - `textToBytes(text: string, codepage?: Codepage): number[]` — default `"cp858"`, firma vieja sigue compilando.
  - `charsetCommand(cp: Codepage): number[]` → `[0x1b, 0x74, n]` con n: cp437→0, cp850→2, cp858→19, win1252→16.
  - `cutCommands(corte: Corte): number[]`.

Contexto para el implementador: hoy hay un solo mapa `CP858` y `CMD.CHARSET_LATIN = [ESC, 0x74, 0x13]`. CP437 y CP850 comparten layout en 0x80-0xAF; CP437 no tiene `Á Í Ó Ú` ni `€` (CP850 agrega esas mayúsculas; CP858 = CP850 + `€` en 0xD5). Win1252 ≈ code points Latin-1 directos, con `€` en 0x80.

- [ ] **Step 1: Escribir los tests que fallan** — `__tests__/lib/escpos-codepages.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { textToBytes, charsetCommand, cutCommands } from "@/lib/escpos"

describe("textToBytes por codepage", () => {
  it("default sigue siendo cp858 (compat con call sites viejos)", () => {
    expect(textToBytes("á€")).toEqual([0xa0, 0xd5])
  })

  it("cp850 = mismo mapa que cp858 pero sin € (cae a '?')", () => {
    expect(textToBytes("áéíóúñÑ", "cp850")).toEqual(textToBytes("áéíóúñÑ", "cp858"))
    expect(textToBytes("€", "cp850")).toEqual([0x3f])
  })

  it("cp437: minusculas acentuadas iguales a cp850; Á Í Ó Ú caen a la vocal sin acento", () => {
    expect(textToBytes("áéíóúñÑ¿¡°", "cp437")).toEqual(textToBytes("áéíóúñÑ¿¡°", "cp850"))
    expect(textToBytes("ÁÍÓÚ", "cp437")).toEqual([0x41, 0x49, 0x4f, 0x55]) // "AIOU"
    expect(textToBytes("É", "cp437")).toEqual([0x90]) // É si existe en 437
    expect(textToBytes("€", "cp437")).toEqual([0x45]) // "E"
  })

  it("win1252: code points Latin-1 directos y € en 0x80", () => {
    expect(textToBytes("áñÑ¿", "win1252")).toEqual([0xe1, 0xf1, 0xd1, 0xbf])
    expect(textToBytes("€", "win1252")).toEqual([0x80])
    expect(textToBytes("好", "win1252")).toEqual([0x3f])
  })
})

describe("charsetCommand — ESC t n por codepage (estandar Epson)", () => {
  it.each([
    ["cp437", 0], ["cp850", 2], ["cp858", 19], ["win1252", 16],
  ] as const)("%s → ESC t %d", (cp, n) => {
    expect(charsetCommand(cp)).toEqual([0x1b, 0x74, n])
  })
})

describe("cutCommands por variante", () => {
  it("gsv: corte parcial GS V 65 3 (comportamiento actual)", () => {
    expect(cutCommands("gsv")).toEqual([0x1d, 0x56, 0x41, 0x03])
  })
  it("esci: feed de despeje + corte legacy ESC i", () => {
    expect(cutCommands("esci")).toEqual([0x1b, 0x64, 0x03, 0x1b, 0x69])
  })
  it("none: solo feed largo, sin comando de corte", () => {
    expect(cutCommands("none")).toEqual([0x1b, 0x64, 0x05])
  })
})
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npm run test:run -- __tests__/lib/escpos-codepages.test.ts`
Expected: FAIL — `charsetCommand is not exported` (y `textToBytes` no acepta segundo argumento).

- [ ] **Step 3: Implementar** en `lib/escpos.ts` — reemplazar el bloque `const CP858 = {...}` y `textToBytes`:

```ts
import type { Codepage, Corte } from "@/lib/thermal-paper"

// Mapa base compartido CP437/CP850/CP858 (idéntico en 0x80-0xAF para el set
// español). CP850 agrega Á Í Ó Ú; CP858 = CP850 + € en 0xD5.
const MAP_BASE: Record<string, number> = {
  "á": 0xa0, "é": 0x82, "í": 0xa1, "ó": 0xa2, "ú": 0xa3, "ñ": 0xa4, "Ñ": 0xa5,
  "É": 0x90,
  "ü": 0x81, "Ü": 0x9a, "ç": 0x87, "Ç": 0x80,
  "¿": 0xa8, "¡": 0xad, "°": 0xf8, "º": 0xa7, "ª": 0xa6,
  "à": 0x85, "è": 0x8a, "ì": 0x8d, "ò": 0x95, "ù": 0x97,
  "â": 0x83, "ê": 0x88, "î": 0x8c, "ô": 0x93, "û": 0x96,
  "ä": 0x84, "ë": 0x89, "ï": 0x8b, "ö": 0x94,
  "«": 0xae, "»": 0xaf,
}
const MAP_CP850: Record<string, number> = {
  ...MAP_BASE,
  "Á": 0xb5, "Í": 0xd6, "Ó": 0xe0, "Ú": 0xe9,
}
const MAP_CP858: Record<string, number> = { ...MAP_CP850, "€": 0xd5 }
// CP437 no tiene estas: caen a un reemplazo legible, no a '?'.
const CP437_FALLBACK: Record<string, string> = {
  "Á": "A", "Í": "I", "Ó": "O", "Ú": "U", "€": "E",
}

// Número de tabla de ESC t según el estándar Epson. Si un firmware mapea
// distinto, el wizard de calibración igual encuentra el par que funciona
// porque cada línea del test se imprime tras seleccionar SU tabla.
const CODEPAGE_TABLE: Record<Codepage, number> = {
  cp437: 0, cp850: 2, cp858: 19, win1252: 16,
}

export function charsetCommand(cp: Codepage): number[] {
  return [ESC, 0x74, CODEPAGE_TABLE[cp]]
}

export function cutCommands(corte: Corte): number[] {
  switch (corte) {
    case "gsv": return [GS, 0x56, 0x41, 0x03] // corte parcial con feed de despeje
    case "esci": return [ESC, 0x64, 0x03, ESC, 0x69] // legacy: ESC i no alimenta, feed manual antes
    case "none": return [ESC, 0x64, 0x05] // sin cortador: feed largo para poder rasgar
  }
}

export function textToBytes(text: string, codepage: Codepage = "cp858"): number[] {
  const bytes: number[] = []
  for (const ch of text) {
    if (codepage === "win1252") {
      if (ch === "€") { bytes.push(0x80); continue }
      const code = ch.charCodeAt(0)
      bytes.push(code <= 0xff ? code : 0x3f)
      continue
    }
    const map = codepage === "cp437" ? MAP_BASE : codepage === "cp850" ? MAP_CP850 : MAP_CP858
    const mapped = map[ch]
    if (mapped !== undefined) { bytes.push(mapped); continue }
    if (codepage === "cp437" && CP437_FALLBACK[ch]) {
      bytes.push(CP437_FALLBACK[ch].charCodeAt(0))
      continue
    }
    const code = ch.charCodeAt(0)
    bytes.push(code <= 0x7f ? code : 0x3f)
  }
  return bytes
}
```

En `CMD`, borrar `CHARSET_LATIN` y `CUT` **todavía no** — recién en la Task 3 cuando los generadores dejen de usarlos.

- [ ] **Step 4: Correr y ver pasar (los nuevos y los viejos de cp858)**

Run: `npm run test:run -- __tests__/lib/escpos-codepages.test.ts __tests__/lib/escpos-cp858.test.ts`
Expected: PASS ambos.

- [ ] **Step 5: Commit**

```bash
git add lib/escpos.ts __tests__/lib/escpos-codepages.test.ts
git commit -m "feat(impresora): codepages cp437/cp850/win1252 y variantes de corte en el motor escpos"
```

---

### Task 3: Generadores parametrizados por perfil + call sites

**Files:**
- Modify: `lib/escpos.ts` (`generateOrdenTicketCommands` línea ~210, `generateTicketCommands` línea ~349, helpers `line`/`columns`/`rightAlign`)
- Modify: `components/ordenes/thermal-print-orden.tsx` (estado `ancho` → perfil)
- Modify: `components/pos/pos-terminal.tsx` (líneas ~193-203 estado propio `pos_printer_width` → perfil; línea 450)
- Test: `__tests__/lib/escpos-profile.test.ts` (nuevo), `__tests__/lib/escpos-orden-ticket.test.ts` (actualizar firma)

**Interfaces:**
- Consumes: `PrinterProfile`, `defaultProfile` (Task 1); `charsetCommand`, `cutCommands`, `textToBytes(text, cp)` (Task 2).
- Produces (las usan Tasks 4, 6, 7):
  - `generateOrdenTicketCommands(data: OrdenTicketData, profile: PrinterProfile, terminologia?: Terminologia): Uint8Array`
  - `generateTicketCommands(data: TicketData, profile: PrinterProfile): Uint8Array`
  - El parámetro `printerWidth: 58 | 80` desaparece de ambas firmas.

- [ ] **Step 1: Escribir los tests que fallan** — `__tests__/lib/escpos-profile.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { generateOrdenTicketCommands, type OrdenTicketData } from "@/lib/escpos"
import { defaultProfile, type PrinterProfile } from "@/lib/thermal-paper"

const baseData: OrdenTicketData = {
  numeroOrden: 1,
  fechaIngreso: "01/08/2026 10:00",
  estado: "Recibido",
  cliente: { nombre: "Juan Pérez" },
  dispositivo: "iPhone 12",
  problemaReportado: "No enciende",
}

function bytesOf(p: PrinterProfile): number[] {
  return Array.from(generateOrdenTicketCommands(baseData, p))
}

function containsSeq(haystack: number[], needle: number[]): boolean {
  return haystack.some((_, i) => needle.every((b, j) => haystack[i + j] === b))
}

describe("generateOrdenTicketCommands segun perfil", () => {
  it("emite ESC t de la codepage del perfil", () => {
    expect(containsSeq(bytesOf({ ...defaultProfile(80), codepage: "win1252" }), [0x1b, 0x74, 16])).toBe(true)
    expect(containsSeq(bytesOf(defaultProfile(80)), [0x1b, 0x74, 19])).toBe(true)
  })

  it("codepage win1252: 'é' de Pérez sale como 0xE9, no como byte CP858", () => {
    expect(bytesOf({ ...defaultProfile(80), codepage: "win1252" })).toContain(0xe9)
  })

  it("corte esci emite ESC i y no GS V; corte none no emite ninguno", () => {
    const esci = bytesOf({ ...defaultProfile(80), corte: "esci" })
    expect(containsSeq(esci, [0x1b, 0x69])).toBe(true)
    expect(containsSeq(esci, [0x1d, 0x56, 0x41])).toBe(false)
    const none = bytesOf({ ...defaultProfile(80), corte: "none" })
    expect(containsSeq(none, [0x1d, 0x56, 0x41])).toBe(false)
    expect(containsSeq(none, [0x1b, 0x69])).toBe(false)
  })

  it("columnas 42: el separador '=' mide 42, no 48", () => {
    const sep42 = Array(42).fill(0x3d) // "=" x42
    const bytes = bytesOf({ ...defaultProfile(80), columnas: 42 })
    expect(containsSeq(bytes, [...sep42, 0x0a])).toBe(true)
    expect(containsSeq(bytes, Array(48).fill(0x3d))).toBe(false)
  })
})
```

Y actualizar `__tests__/lib/escpos-orden-ticket.test.ts`: cada llamada `generateOrdenTicketCommands(x, 80)` pasa a `generateOrdenTicketCommands(x, defaultProfile(80))`, y `(x, 58, custom)` a `(x, defaultProfile(58), custom)` (importar `defaultProfile` de `@/lib/thermal-paper`).

- [ ] **Step 2: Correr y ver fallar**

Run: `npm run test:run -- __tests__/lib/escpos-profile.test.ts`
Expected: FAIL — TypeScript/runtime: el perfil no es un número de ancho.

- [ ] **Step 3: Implementar en `lib/escpos.ts`**

3a. Factory de helpers con codepage (los module-level `line`/`columns`/`rightAlign` quedan para `separator`/`doubleSeparator`/`qrCommands`, que son ASCII-only e idénticos en las 4 tablas):

```ts
// Helpers de texto ligados a una codepage. Dentro de los generadores SHADOWEAN
// a los module-level homónimos, así el cuerpo de los generadores no cambia.
function makeTextHelpers(cp: Codepage) {
  const line = (text: string): number[] => [...textToBytes(text, cp), LF]
  const columns = (left: string, right: string, width: number): number[] => {
    const gap = width - left.length - right.length
    if (gap <= 0) return line(left.substring(0, width - right.length - 1) + " " + right)
    return line(left + " ".repeat(gap) + right)
  }
  const rightAlign = (text: string, width: number): number[] => {
    const pad = Math.max(0, width - text.length)
    return line(" ".repeat(pad) + text)
  }
  return { line, columns, rightAlign }
}
```

3b. En **ambos** generadores, cambiar la firma y las 3 primeras líneas del cuerpo:

```ts
export function generateOrdenTicketCommands(
  data: OrdenTicketData,
  profile: PrinterProfile,
  terminologia?: Terminologia,
): Uint8Array {
  const term = terminologia ?? resolveTerminologia(null)
  const W = profile.columnas
  const { line, columns } = makeTextHelpers(profile.codepage)
  // ...resto del cuerpo intacto, salvo:
  // - add(CMD.INIT, CMD.CHARSET_LATIN)  →  add(CMD.INIT, charsetCommand(profile.codepage))
  // - add(CMD.CUT)                      →  add(cutCommands(profile.corte))
```

`generateTicketCommands(data: TicketData, profile: PrinterProfile)` igual (usa `line`, `columns`). Importar `PrinterProfile` de `@/lib/thermal-paper`. Borrar `CHARSET_LATIN` y `CUT` de `CMD`, y las constantes `CHARS_PER_LINE_58/80` (ya nadie las usa). Actualizar el doc comment del archivo (58≈32, 80≈42-48 según impresora, ahora por perfil).

3c. Call site órdenes — `components/ordenes/thermal-print-orden.tsx`:

```tsx
import { readProfile, saveAncho, anchoToPx, anchoLogoDots, ANCHOS_TERMICOS, defaultProfile, type PrinterProfile, type AnchoTermico } from "@/lib/thermal-paper"

const [profile, setProfile] = useState<PrinterProfile>(defaultProfile())
useEffect(() => { setProfile(readProfile()) }, [])
```

Reemplazos mecánicos: `ancho` → `profile.ancho` (en `anchoLogoDots`, `anchoToPx`, `@page`, título, preview); botones de ancho: `onClick={() => { saveAncho(a); setProfile(readProfile()) }}` y comparación `profile.ancho === a`; la llamada pasa a `generateOrdenTicketCommands(ticketData, profile, terminologia)`. Se van `readAncho`/`saveAncho`-directo-a-estado, `DEFAULT_ANCHO` y el estado `ancho`.

3d. Call site POS — `components/pos/pos-terminal.tsx` (líneas ~193-203): borrar el estado `printerWidth`/`pos_printer_width` y reemplazar por el mismo patrón de perfil:

```tsx
import { readProfile, saveAncho, defaultProfile, type PrinterProfile } from "@/lib/thermal-paper"

const [profile, setProfile] = useState<PrinterProfile>(defaultProfile())
useEffect(() => { setProfile(readProfile()) }, [])
const printerWidth = profile.ancho // las ~6 referencias de layout siguen funcionando
const handleSetPrinterWidth = (w: 58 | 80) => { saveAncho(w); setProfile(readProfile()) }
```

Línea 450: `generateTicketCommands(ticketData, profile)`. En el `useCallback` de `printTicket`, agregar `profile` a las dependencias (hoy `[printer]`, línea 459 — y `printTicketHTML` ya depende de `printerWidth`, que ahora deriva del perfil).

Nota: el default efectivo del POS cambia de 58 a 80 para quien nunca guardó nada (unificación deliberada, decisión 2 del spec: un dispositivo = una impresora; quien tenía `pos_printer_width` guardado migra su valor).

- [ ] **Step 4: Correr todo y ver pasar**

Run: `npm run test:run`
Expected: PASS completo (incluye `escpos-orden-ticket` actualizado). `npx tsc --noEmit` también limpio (o `npm run build` en la Task 9 lo confirma).

- [ ] **Step 5: Commit**

```bash
git add lib/escpos.ts components/ordenes/thermal-print-orden.tsx components/pos/pos-terminal.tsx __tests__/lib/escpos-profile.test.ts __tests__/lib/escpos-orden-ticket.test.ts
git commit -m "feat(impresora): generadores escpos parametrizados por perfil y perfil unico ordenes/POS"
```

---

### Task 4: Tests de calibración y reducer del wizard — `lib/printer-calibration.ts`

**Files:**
- Create: `lib/printer-calibration.ts`
- Test: `__tests__/lib/printer-calibration.test.ts` (nuevo)

**Interfaces:**
- Consumes: `textToBytes`, `charsetCommand`, `cutCommands`, `generateOrdenTicketCommands` (Tasks 2-3); tipos de perfil (Task 1).
- Produces (las usa Task 6):
  - `generateColumnsTest(): Uint8Array` — reglas de 32/42/48.
  - `generateCodepageTest(): Uint8Array` — 4 líneas numeradas, cada una tras su `ESC t`.
  - `generateCutTest(): Uint8Array` — bloques 1 (gsv) y 2 (esci).
  - `generateSampleTicket(profile: PrinterProfile): Uint8Array` — ticket de prueba completo.
  - `CODEPAGE_CANDIDATAS: Codepage[]`, `COLUMNAS_CANDIDATAS: readonly [32, 42, 48]`
  - `type WizardStep = "conexion" | "columnas" | "acentos" | "corte" | "final"`
  - `type WizardAction = { type: "conectado" } | { type: "columnas"; columnas: 32 | 42 | 48 } | { type: "codepage"; codepage: Codepage } | { type: "corte"; corte: Corte } | { type: "reiniciar" }`
  - `interface WizardState { step: WizardStep; profile: PrinterProfile }`
  - `wizardReducer(state: WizardState, action: WizardAction): WizardState`

- [ ] **Step 1: Escribir los tests que fallan** — `__tests__/lib/printer-calibration.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  generateColumnsTest, generateCodepageTest, generateCutTest, generateSampleTicket,
  wizardReducer, type WizardState,
  COLUMNAS_CANDIDATAS, CODEPAGE_CANDIDATAS,
} from "@/lib/printer-calibration"
import { defaultProfile } from "@/lib/thermal-paper"

function containsSeq(haystack: number[], needle: number[]): boolean {
  return haystack.some((_, i) => needle.every((b, j) => haystack[i + j] === b))
}
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0))

describe("generateColumnsTest", () => {
  it("imprime una regla de exactamente N chars terminada en | por cada candidata", () => {
    const bytes = Array.from(generateColumnsTest())
    for (const n of COLUMNAS_CANDIDATAS) {
      // regla: "123456789.123..." recortada a n-1 + "|"
      let regla = ""
      while (regla.length < n - 1) regla += "123456789."
      regla = regla.slice(0, n - 1) + "|"
      expect(regla).toHaveLength(n)
      expect(containsSeq(bytes, [...ascii(regla), 0x0a])).toBe(true)
    }
  })
})

describe("generateCodepageTest", () => {
  it("selecciona la tabla de cada candidata ANTES de su linea (par ESC t + texto)", () => {
    const bytes = Array.from(generateCodepageTest())
    // cp437(0), cp850(2), cp858(19), win1252(16), en ese orden
    for (const [i, n] of [0, 2, 19, 16].entries()) {
      const idx = bytes.findIndex((_, k) => bytes[k] === 0x1b && bytes[k + 1] === 0x74 && bytes[k + 2] === n)
      expect(idx, `ESC t ${n}`).toBeGreaterThan(-1)
      // el numero de linea "N)" viene despues del selector de SU tabla
      expect(containsSeq(bytes.slice(idx), ascii(`${i + 1})`))).toBe(true)
    }
  })

  it("termina restaurando cp858 (el default del motor)", () => {
    const bytes = Array.from(generateCodepageTest())
    const last = bytes.lastIndexOf(0x74)
    expect(bytes[last + 1]).toBe(19)
  })
})

describe("generateCutTest", () => {
  it("bloque 1 corta con GS V y bloque 2 con ESC i", () => {
    const bytes = Array.from(generateCutTest())
    const gsv = bytes.findIndex((_, k) => bytes[k] === 0x1d && bytes[k + 1] === 0x56)
    const esci = bytes.findIndex((_, k) => bytes[k] === 0x1b && bytes[k + 1] === 0x69)
    expect(gsv).toBeGreaterThan(-1)
    expect(esci).toBeGreaterThan(gsv) // primero gsv, despues esci
  })
})

describe("generateSampleTicket", () => {
  it("usa el generador real de ordenes con el perfil dado", () => {
    const bytes = Array.from(generateSampleTicket({ ...defaultProfile(80), codepage: "win1252" }))
    expect(containsSeq(bytes, [0x1b, 0x74, 16])).toBe(true)
  })
})

describe("wizardReducer", () => {
  const inicio: WizardState = { step: "conexion", profile: defaultProfile() }

  it("conectado avanza a columnas", () => {
    expect(wizardReducer(inicio, { type: "conectado" }).step).toBe("columnas")
  })

  it("elegir columnas fija columnas, deriva ancho (32→58, 42/48→80) y avanza", () => {
    const s = wizardReducer({ ...inicio, step: "columnas" }, { type: "columnas", columnas: 32 })
    expect(s.profile).toMatchObject({ columnas: 32, ancho: 58 })
    expect(s.step).toBe("acentos")
    const s2 = wizardReducer({ ...inicio, step: "columnas" }, { type: "columnas", columnas: 42 })
    expect(s2.profile).toMatchObject({ columnas: 42, ancho: 80 })
  })

  it("elegir codepage y corte completan el perfil y llegan a final", () => {
    let s: WizardState = { step: "acentos", profile: defaultProfile() }
    s = wizardReducer(s, { type: "codepage", codepage: "win1252" })
    expect(s.step).toBe("corte")
    s = wizardReducer(s, { type: "corte", corte: "esci" })
    expect(s.step).toBe("final")
    expect(s.profile).toMatchObject({ codepage: "win1252", corte: "esci" })
  })

  it("reiniciar vuelve a conexion conservando el perfil actual", () => {
    const s = wizardReducer({ step: "final", profile: { ...defaultProfile(), columnas: 42 } }, { type: "reiniciar" })
    expect(s.step).toBe("conexion")
    expect(s.profile.columnas).toBe(42)
  })
})
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npm run test:run -- __tests__/lib/printer-calibration.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar** — `lib/printer-calibration.ts`:

```ts
// Tests físicos de calibración y máquina de pasos del wizard de impresora.
// Los tests se imprimen por WebUSB; el usuario elige qué salió bien y esa
// elección arma el PrinterProfile (ver spec 2026-08-03).

import { textToBytes, charsetCommand, cutCommands, generateOrdenTicketCommands } from "@/lib/escpos"
import type { Codepage, Corte, PrinterProfile } from "@/lib/thermal-paper"

const ESC = 0x1b
const LF = 0x0a
const INIT = [ESC, 0x40]
const FEED_3 = [ESC, 0x64, 0x03]
const FEED_5 = [ESC, 0x64, 0x05]

export const COLUMNAS_CANDIDATAS = [32, 42, 48] as const
export const CODEPAGE_CANDIDATAS: Codepage[] = ["cp437", "cp850", "cp858", "win1252"]

const line = (text: string): number[] => [...textToBytes(text), LF]

/** Regla de exactamente n caracteres: "123456789.123..." + "|" al final. */
function regla(n: number): string {
  let s = ""
  while (s.length < n - 1) s += "123456789."
  return s.slice(0, n - 1) + "|"
}

export function generateColumnsTest(): Uint8Array {
  const buf: number[] = [...INIT]
  buf.push(...line("TEST DE COLUMNAS"))
  COLUMNAS_CANDIDATAS.forEach((n, i) => {
    buf.push(...line(`${i + 1}) ${n} columnas:`))
    buf.push(...line(regla(n)))
  })
  buf.push(...FEED_5)
  return new Uint8Array(buf)
}

export function generateCodepageTest(): Uint8Array {
  const buf: number[] = [...INIT]
  buf.push(...line("TEST DE ACENTOS"))
  CODEPAGE_CANDIDATAS.forEach((cp, i) => {
    // Cada línea se imprime tras seleccionar SU tabla: lo que el usuario elige
    // es el par (ESC t n, encoder) que su firmware realmente entiende.
    buf.push(...charsetCommand(cp))
    buf.push(...textToBytes(`${i + 1}) áéíóúñÑ ¿¡°`, cp), LF)
  })
  buf.push(...charsetCommand("cp858")) // restaurar el default del motor
  buf.push(...FEED_5)
  return new Uint8Array(buf)
}

export function generateCutTest(): Uint8Array {
  const buf: number[] = [...INIT]
  buf.push(...line("CORTE 1"))
  buf.push(...FEED_3, ...cutCommands("gsv"))
  buf.push(...line("CORTE 2"))
  buf.push(...FEED_3, ...cutCommands("esci"))
  buf.push(...line("FIN DEL TEST"))
  buf.push(...FEED_5)
  return new Uint8Array(buf)
}

export function generateSampleTicket(profile: PrinterProfile): Uint8Array {
  return generateOrdenTicketCommands(
    {
      numeroOrden: 0,
      codigoOrden: "TEST-CALIBRACION",
      fechaIngreso: "Ticket de prueba",
      estado: "Calibración",
      cliente: { nombre: "Cliente de Prueba", telefono: "011-1234-5678" },
      dispositivo: "Impresora térmica",
      problemaReportado: "Si este ticket se lee bien de borde a borde y los acentos salen correctos (áéíóúñÑ ¿¡°), la calibración quedó lista.",
    },
    profile,
  )
}

export type WizardStep = "conexion" | "columnas" | "acentos" | "corte" | "final"

export type WizardAction =
  | { type: "conectado" }
  | { type: "columnas"; columnas: 32 | 42 | 48 }
  | { type: "codepage"; codepage: Codepage }
  | { type: "corte"; corte: Corte }
  | { type: "reiniciar" }

export interface WizardState {
  step: WizardStep
  profile: PrinterProfile
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "conectado":
      return { ...state, step: "columnas" }
    case "columnas": {
      const ancho = action.columnas === 32 ? 58 : 80
      return { step: "acentos", profile: { ...state.profile, ancho, columnas: action.columnas } }
    }
    case "codepage":
      return { step: "corte", profile: { ...state.profile, codepage: action.codepage } }
    case "corte":
      return { step: "final", profile: { ...state.profile, corte: action.corte } }
    case "reiniciar":
      return { ...state, step: "conexion" }
  }
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npm run test:run -- __tests__/lib/printer-calibration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/printer-calibration.ts __tests__/lib/printer-calibration.test.ts
git commit -m "feat(impresora): tests fisicos de calibracion y reducer del wizard"
```

---

### Task 5: Error de claim USB legible — `use-thermal-printer.ts`

**Files:**
- Modify: `components/pos/use-thermal-printer.ts` (catch de `connect`, línea ~194)
- Test: `__tests__/components/describe-usb-error.test.ts` (nuevo)

**Interfaces:**
- Produces: `describeUsbError(err: unknown): string` exportada del mismo archivo (la usa el hook internamente; el wizard muestra `state.error` como hasta ahora).

Contexto: en Windows, cuando el driver de la impresora está instalado, `usbprint.sys` posee la interfaz USB y `open()`/`claimInterface()` fallan con `SecurityError` (o mensajes con "claim"/"protected class"). Hoy el usuario ve ese mensaje críptico en inglés.

- [ ] **Step 1: Escribir los tests que fallan** — `__tests__/components/describe-usb-error.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { describeUsbError } from "@/components/pos/use-thermal-printer"

const mk = (name: string, message: string) => Object.assign(new Error(message), { name })

describe("describeUsbError", () => {
  it("SecurityError → mensaje accionable que redirige al camino navegador", () => {
    const msg = describeUsbError(mk("SecurityError", "Access denied"))
    expect(msg).toContain("driver")
    expect(msg).toContain("Imprimir (navegador)")
  })

  it("mensajes con 'claim' o 'protected class' → mismo mensaje del driver", () => {
    expect(describeUsbError(mk("NetworkError", "Unable to claim interface"))).toContain("Imprimir (navegador)")
    expect(describeUsbError(mk("SecurityError", "The requested interface implements a protected class"))).toContain("Imprimir (navegador)")
  })

  it("NetworkError sin claim → desconexion", () => {
    expect(describeUsbError(mk("NetworkError", "Device unavailable"))).toContain("desconect")
  })

  it("otros errores conservan su mensaje; sin mensaje → generico", () => {
    expect(describeUsbError(mk("TypeError", "boom"))).toBe("boom")
    expect(describeUsbError(null)).toBe("Error al conectar impresora")
  })
})
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npm run test:run -- __tests__/components/describe-usb-error.test.ts`
Expected: FAIL — no exportada.

- [ ] **Step 3: Implementar** en `components/pos/use-thermal-printer.ts`:

```ts
/**
 * Traduce errores de WebUSB a mensajes accionables. El caso clave: en Windows
 * usbprint.sys se apropia de la impresora cuando su driver está instalado y el
 * claim falla — la salida correcta para el usuario es imprimir por navegador
 * (que usa justamente ese driver), no pelear contra el sistema.
 */
export function describeUsbError(err: unknown): string {
  const e = err as { name?: string; message?: string } | null
  const msg = e?.message ?? ""
  if (e?.name === "SecurityError" || /claim|protected class/i.test(msg)) {
    return 'Windows está usando el driver de esta impresora y bloquea la conexión USB directa. Use "Imprimir (navegador)": imprime a través de ese mismo driver.'
  }
  if (e?.name === "NetworkError") {
    return "La impresora se desconectó o no responde. Verifique el cable USB."
  }
  return msg || "Error al conectar impresora"
}
```

Y en el `catch` de `connect` (línea ~194), conservando el caso de cancelación:

```ts
} catch (err: any) {
  if (err.name === "NotFoundError") {
    setState((s) => ({ ...s, connecting: false }))
    return
  }
  setState({ connected: false, device: null, connecting: false, error: describeUsbError(err) })
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npm run test:run -- __tests__/components/describe-usb-error.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/pos/use-thermal-printer.ts __tests__/components/describe-usb-error.test.ts
git commit -m "feat(impresora): mensaje accionable cuando windows bloquea el claim usb"
```

---

### Task 6: Wizard de calibración — `components/impresora/printer-calibration-wizard.tsx`

**Files:**
- Create: `components/impresora/printer-calibration-wizard.tsx`
- Test: `__tests__/components/printer-calibration-wizard.test.tsx` (nuevo)

**Interfaces:**
- Consumes: reducer y generadores (Task 4), `useThermalPrinter` + `describeUsbError` vía `state.error` (Task 5), `readProfile`/`saveProfile` (Task 1), `fitPrintPageToContent` (existente), Dialog/Button de `components/ui`.
- Produces (la usan las entradas de Task 7):
  - `PrinterCalibrationWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void })` — componente controlado; al cerrarse, el host relee el perfil (`readProfile()`).

- [ ] **Step 1: Escribir el test de componente que falla** — `__tests__/components/printer-calibration-wizard.test.tsx` (jsdom es el env default; mockear el hook para no depender de WebUSB):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PrinterCalibrationWizard } from "@/components/impresora/printer-calibration-wizard"
import { readProfile } from "@/lib/thermal-paper"

const printMock = vi.fn().mockResolvedValue(true)
vi.mock("@/components/pos/use-thermal-printer", () => ({
  useThermalPrinter: () => ({
    connected: true, connecting: false, device: { name: "Test", vendorId: 1, productId: 1 },
    error: null, isSupported: true,
    connect: vi.fn(), disconnect: vi.fn(), print: printMock,
  }),
}))

describe("PrinterCalibrationWizard", () => {
  beforeEach(() => {
    localStorage.clear()
    printMock.mockClear()
  })

  it("con impresora conectada arranca en el paso de columnas e imprime el test al pedirlo", async () => {
    render(<PrinterCalibrationWizard open onOpenChange={() => {}} />)
    expect(screen.getByText(/test de columnas/i)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /imprimir test/i }))
    await vi.waitFor(() => expect(printMock).toHaveBeenCalledTimes(1))
  })

  it("responder columnas persiste el perfil y avanza a acentos", () => {
    render(<PrinterCalibrationWizard open onOpenChange={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /^2\)/ })) // "2) 42 columnas"
    expect(readProfile()).toMatchObject({ columnas: 42, ancho: 80 })
    expect(screen.getByText(/test de acentos/i)).toBeTruthy()
  })

  it("el flujo completo persiste codepage y corte", () => {
    render(<PrinterCalibrationWizard open onOpenChange={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /^3\)/ })) // 48 col
    fireEvent.click(screen.getByRole("button", { name: /^4\)/ })) // win1252
    fireEvent.click(screen.getByRole("button", { name: /no corta/i }))
    expect(readProfile()).toMatchObject({ columnas: 48, codepage: "win1252", corte: "none" })
    expect(screen.getByText(/ticket de prueba/i)).toBeTruthy()
  })
})
```

Nota: si `@testing-library/jest-dom` no está registrado globalmente en `vitest.setup`, usar `toBeTruthy()` como arriba (no depender de `toBeInTheDocument`).

- [ ] **Step 2: Correr y ver fallar**

Run: `npm run test:run -- __tests__/components/printer-calibration-wizard.test.tsx`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar el componente.** Estructura completa (~230 líneas):

```tsx
"use client"

import { useEffect, useReducer, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Loader2, Printer, Usb } from "lucide-react"
import { useThermalPrinter } from "@/components/pos/use-thermal-printer"
import { fitPrintPageToContent } from "@/lib/print-fit-page"
import { readProfile, saveProfile, type AnchoTermico } from "@/lib/thermal-paper"
import {
  wizardReducer, type WizardState,
  generateColumnsTest, generateCodepageTest, generateCutTest, generateSampleTicket,
  COLUMNAS_CANDIDATAS, CODEPAGE_CANDIDATAS,
} from "@/lib/printer-calibration"
import { toast } from "sonner"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const CODEPAGE_LABELS: Record<string, string> = {
  cp437: "CP437", cp850: "CP850", cp858: "CP858 (estándar)", win1252: "Windows-1252",
}

export function PrinterCalibrationWizard({ open, onOpenChange }: Props) {
  const printer = useThermalPrinter()
  const [state, dispatch] = useReducer(wizardReducer, undefined, () => ({
    step: "conexion" as const,
    profile: readProfile(),
  }))
  const [printing, setPrinting] = useState(false)

  // Con impresora ya conectada (o al conectarse) se saltea el paso de conexión.
  useEffect(() => {
    if (open && printer.connected && state.step === "conexion") dispatch({ type: "conectado" })
  }, [open, printer.connected, state.step])

  const apply = (action: Parameters<typeof wizardReducer>[1]) => {
    const next = wizardReducer(state, action)
    saveProfile(next.profile)
    dispatch(action)
  }

  const printTest = async (data: Uint8Array) => {
    setPrinting(true)
    try {
      const ok = await printer.print(data)
      if (!ok) toast.error("No se pudo imprimir el test")
    } finally {
      setPrinting(false)
    }
  }

  // ...render por paso (ver esqueleto abajo)
}
```

Render por paso (dentro del `DialogContent`, con `DialogTitle` "Calibrar impresora térmica"):

- **conexion**: botón `Conectar impresora USB` (`printer.connect`); si `printer.error`, mostrarlo en un `<p className="text-sm text-destructive">` — con Task 5 ya llega legible. Debajo, siempre visible, el bloque del **camino navegador**: botón "Imprimir página de prueba (navegador)" (`printDriverTestPage(state.profile.ancho)`) y la guía: `<ul>` con "Papel: 80mm (o 58mm según su rollo)", "Márgenes: 0", "Escala: 100% (no 'ajustar a página')". Si `!printer.isSupported`, mostrar solo este bloque.
- **columnas**: texto "Test de columnas" + botón "Imprimir test" → `printTest(generateColumnsTest())` + pregunta "¿Cuál es la línea más larga donde la barra | quedó en el mismo renglón?" + un botón por candidata: `1) 32 columnas` / `2) 42 columnas` / `3) 48 columnas` → `apply({ type: "columnas", columnas: n })`.
- **acentos**: "Test de acentos" + botón "Imprimir test" → `generateCodepageTest()` + "¿En qué número se leen bien los acentos?" + botones `1) CP437` … `4) Windows-1252` → `apply({ type: "codepage", codepage: cp })`.
- **corte**: "Test de corte" + botón "Imprimir test" → `generateCutTest()` + "¿Después de qué número cortó el papel?" + botones `Cortó después del 1` → `gsv`, `Cortó después del 2` → `esci`, `No corta` → `none`.
- **final**: "Ticket de prueba" + resumen del perfil (`80mm · 48 columnas · CP858 · corte GS V`) + botón "Imprimir ticket de prueba" → `printTest(generateSampleTicket(state.profile))` + botón secundario "Volver a calibrar" → `apply({ type: "reiniciar" })` + botón "Listo" → `onOpenChange(false)`.

Cada paso de test lleva también un link chico "Imprimir de nuevo" (mismo handler) por si el papel se atascó.

`printDriverTestPage` en el mismo archivo (patrón iframe de `thermal-print-orden.tsx`, reducido a contenido estático):

```tsx
function printDriverTestPage(ancho: AnchoTermico) {
  const iframe = document.createElement("iframe")
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0"
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument || iframe.contentWindow?.document
  if (!doc) { document.body.removeChild(iframe); return }
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8" /><style>
  @page { size: ${ancho}mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: ${ancho}mm; font-family: 'Courier New', monospace; font-size: 12px; color: #000; }
  #test { padding: 2mm; box-sizing: border-box; text-align: center; }
  </style></head><body><div id="test">
  <div><strong>PÁGINA DE PRUEBA</strong></div>
  <div>Ancho configurado: ${ancho}mm</div>
  <div>áéíóúñÑ ¿¡°</div>
  <div>${"1234567890".repeat(5).slice(0, 48)}</div>
  <div>Si este texto llega de borde a borde sin cortarse, el driver está bien configurado.</div>
  </div></body></html>`)
  doc.close()
  const trigger = () => {
    fitPrintPageToContent(doc, doc.getElementById("test"), ancho)
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe) }, 500)
  }
  if (doc.readyState === "complete") trigger()
  else iframe.onload = trigger
}
```

- [ ] **Step 4: Correr y ver pasar**

Run: `npm run test:run -- __tests__/components/printer-calibration-wizard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/impresora/printer-calibration-wizard.tsx __tests__/components/printer-calibration-wizard.test.tsx
git commit -m "feat(impresora): wizard de calibracion con tests fisicos y pagina de prueba del driver"
```

---

### Task 7: Puntos de entrada al wizard

**Files:**
- Modify: `components/configuracion/configuracion-form.tsx` (card "Comprobante Termico (Impresora)", línea ~736)
- Modify: `components/ordenes/thermal-print-orden.tsx` (pie del dialog, línea ~313)
- Modify: `components/pos/pos-terminal.tsx` (junto al toggle de ancho, líneas ~695-715)
- Test: no requiere tests nuevos (wiring puro; el wizard ya está testeado). `npm run test:run` completo debe seguir verde.

**Interfaces:**
- Consumes: `PrinterCalibrationWizard` (Task 6), `readProfile` (Task 1).

- [ ] **Step 1: Configuración** — en `configuracion-form.tsx`, dentro del `CardContent` de la card "Comprobante Termico (Impresora)", agregar al final:

```tsx
<div className="pt-2 border-t">
  <p className="text-xs sm:text-sm text-muted-foreground mb-2">
    Si el ticket sale con el texto cortado, acentos ilegibles o no corta el papel,
    calibre la impresora desde este dispositivo.
  </p>
  <Button type="button" variant="outline" onClick={() => setWizardOpen(true)}>
    <Printer className="mr-2 h-4 w-4" />
    Calibrar impresora
  </Button>
</div>
```

Con `const [wizardOpen, setWizardOpen] = useState(false)` y `<PrinterCalibrationWizard open={wizardOpen} onOpenChange={setWizardOpen} />` al final del componente (fuera de la card). Importar `Printer` de lucide si no está.

- [ ] **Step 2: Dialog de órdenes** — en `thermal-print-orden.tsx`, debajo de la fila de botones de impresión:

```tsx
<button
  type="button"
  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
  onClick={() => setWizardOpen(true)}
>
  ¿Salió mal? Calibrar impresora
</button>
```

Estado `wizardOpen` + `<PrinterCalibrationWizard open={wizardOpen} onOpenChange={(o) => { setWizardOpen(o); if (!o) setProfile(readProfile()) }} />` — al cerrar el wizard, el dialog relee el perfil calibrado.

- [ ] **Step 3: POS** — en `pos-terminal.tsx`, junto a los botones 58/80 existentes, el mismo link y el mismo patrón de `onOpenChange` releyendo el perfil.

- [ ] **Step 4: Verificar**

Run: `npm run test:run` y `npx tsc --noEmit`
Expected: PASS / sin errores.

- [ ] **Step 5: Commit**

```bash
git add components/configuracion/configuracion-form.tsx components/ordenes/thermal-print-orden.tsx components/pos/pos-terminal.tsx
git commit -m "feat(impresora): accesos al wizard desde configuracion, ordenes y pos"
```

---

### Task 8: Verificación final y PRs

- [ ] **Step 1: Suite completa + lint + build**

```bash
npm run test:run
npm run lint
npm run build
```

Expected: todo verde. Si `build` falla por tipos, arreglar antes de seguir.

- [ ] **Step 2: PRs encadenados** (el diff total supera el presupuesto de 400 líneas)

- PR #1 — commits de Tasks 0-5 (perfil + motor + error USB): base `main`, branch `feat/calibracion-impresora-termica`. Autocontenido: sin wizard, el default replica el comportamiento actual.
- PR #2 — commits de Tasks 6-7 (wizard + entradas): branch `feat/calibracion-impresora-wizard` apilada sobre la anterior.

Usar el flujo de PR habitual del repo (issue-first si aplica, conventional commits, sin atribución de IA). Si al llegar acá el usuario prefiere un solo PR con `size:exception`, respetarlo — preguntar antes de abrir.

- [ ] **Step 3: Prueba manual mínima** (requiere hardware): en un dispositivo con impresora térmica, correr el wizard completo y verificar que órdenes y POS imprimen con el perfil calibrado. Documentar en el PR que la salida física queda pendiente de validación del usuario si no hay impresora a mano.
