// @vitest-environment node
import { describe, it, expect } from "vitest"
import { bloquesDeTexto } from "@/lib/asistente/bloques"
import { sugerenciasPara, SUGERENCIAS_MANUAL } from "@/lib/asistente/sugerencias"
import { leerNdjson } from "@/lib/asistente/leer-ndjson"

describe("bloquesDeTexto", () => {
  it("separa párrafos, viñetas, pasos numerados y títulos", () => {
    const texto = "## Órdenes atrasadas\nTenés 2:\n- **CEL-1** iPhone\n- CEL-2 Moto\n\nPara entregarla:\n1. Abrí la orden\n2. Tocá Entregar\n\nListo."
    expect(bloquesDeTexto(texto)).toEqual([
      { tipo: "titulo", texto: "Órdenes atrasadas" },
      { tipo: "parrafo", texto: "Tenés 2:" },
      { tipo: "lista", ordenada: false, items: ["**CEL-1** iPhone", "CEL-2 Moto"] },
      { tipo: "parrafo", texto: "Para entregarla:" },
      { tipo: "lista", ordenada: true, items: ["Abrí la orden", "Tocá Entregar"] },
      { tipo: "parrafo", texto: "Listo." },
    ])
  })

  it("una lista numerada que no arranca en 1 conserva el número", () => {
    expect(bloquesDeTexto("3. Tercero\n4. Cuarto")).toEqual([{ tipo: "lista", ordenada: true, items: ["Tercero", "Cuarto"], inicio: 3 }])
  })

  it("una línea con sangría después de un ítem lo continúa", () => {
    expect(bloquesDeTexto("- Uno\n  sigue")).toEqual([{ tipo: "lista", ordenada: false, items: ["Uno sigue"] }])
  })

  it("los saltos de línea simples quedan dentro del párrafo", () => {
    expect(bloquesDeTexto("a\nb")).toEqual([{ tipo: "parrafo", texto: "a\nb" }])
  })

  it("texto vacío no da bloques", () => {
    expect(bloquesDeTexto("")).toEqual([])
  })
})

describe("sugerenciasPara", () => {
  const h = (...nombres: string[]) => nombres.map((name) => ({ definicion: { name } as any }))
  const todas = h("ver_orden", "buscar_ordenes", "resumen_cliente", "resumen_ordenes")

  it("con todas las herramientas y deuda: datos primero y una del manual", () => {
    expect(sugerenciasPara(todas, true)).toEqual([
      "¿Qué órdenes están atrasadas?",
      "¿Cómo vienen las órdenes hoy?",
      "¿Cuánto me debe un cliente?",
      "¿Cómo creo una orden de servicio?",
    ])
  })

  it("sin permiso de deuda no sugiere preguntar por deudas", () => {
    const s = sugerenciasPara(todas, false)
    expect(s.some((x) => /debe/i.test(x))).toBe(false)
    expect(s).toContain("¿Qué órdenes tiene un cliente?")
  })

  it("sin herramientas quedan solo preguntas del manual", () => {
    const s = sugerenciasPara([], false)
    expect(s).toHaveLength(3)
    expect(s.every((x) => SUGERENCIAS_MANUAL.includes(x))).toBe(true)
  })
})

describe("leerNdjson", () => {
  function cuerpo(...trozos: string[]) {
    const enc = new TextEncoder()
    return new ReadableStream<Uint8Array>({
      start(c) {
        for (const t of trozos) c.enqueue(enc.encode(t))
        c.close()
      },
    })
  }
  const leer = async (body: ReadableStream<Uint8Array>) => {
    const out: unknown[] = []
    for await (const e of leerNdjson(body)) out.push(e)
    return out
  }

  it("arma eventos aunque una línea llegue partida en dos trozos", async () => {
    expect(await leer(cuerpo('{"a":1}\n{"b"', ':2}\n{"c":3}'))).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  })

  it("descarta líneas inválidas sin cortar el resto", async () => {
    expect(await leer(cuerpo('{"a":1}\nbasura\n\n{"b":2}\n'))).toEqual([{ a: 1 }, { b: 2 }])
  })

  it("respeta caracteres multibyte partidos entre trozos", async () => {
    const bytes = new TextEncoder().encode('{"t":"órden"}\n')
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 7))
        c.enqueue(bytes.slice(7))
        c.close()
      },
    })
    expect(await leer(body)).toEqual([{ t: "órden" }])
  })
})
