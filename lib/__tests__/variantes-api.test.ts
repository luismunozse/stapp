// @vitest-environment node
import { describe, it, expect, vi } from "vitest"
import { z } from "zod"
import { type Payload, ID, base, conFila } from "@/__tests__/helpers/variantes-payload"
import { guardarGrupoSchema } from "@/lib/variantes-schema"
import {
  mapearErrorRpc,
  esReintentable,
  conReintento,
  migracionPendiente,
  respuestaDeError,
  respuestaDeValidacion,
} from "@/lib/variantes-api"

// The server-only half of PUT /api/inventario/grupos/[id]: the map from the errors of the save
// RPC to HTTP answers, the deadlock retry, the 503 for a missing migration and the 400 for a
// rejected body.

// ---- error map -------------------------------------------------------------------------
// PostgREST hands back { code: SQLSTATE, message: RAISE text, details, hint }. Messages below
// are the real ones (verify/361_probes.sql, Postgres and PostgREST), not bare codes (G1).
const err = (code: string, message: string) => ({ code, message, details: null, hint: null })
const RESERVADO = `STOCK_RESERVADO:${ID(5)}:3`

describe("mapearErrorRpc: the RPC codes", () => {
  it.each([
    ["22023 invalid payload", err("22023", "PAYLOAD_INVALIDO: a barcode is repeated inside the save"), 400, "PAYLOAD_INVALIDO"],
    ["P0002 not found", err("P0002", "NO_ENCONTRADO: item " + ID(1)), 404, "NO_ENCONTRADO"],
    ["P0030 duplicate combination", err("P0030", "COMBINACION_DUPLICADA"), 409, "COMBINACION_DUPLICADA"],
    ["P0031 item in another group", err("P0031", "ITEM_EN_OTRO_GRUPO: " + ID(2)), 409, "ITEM_EN_OTRO_GRUPO"],
    ["P0032 kit", err("P0032", "KIT_NO_PERMITIDO: " + ID(3)), 422, "KIT_NO_PERMITIDO"],
    ["P0033 reserved stock", err("P0033", RESERVADO), 409, "STOCK_RESERVADO"],
    ["P0034 over the limits", err("P0034", "LIMITE_EXCEDIDO: at most 100 combinations"), 422, "LIMITE_EXCEDIDO"],
    ["P0035 duplicate code", err("P0035", "CODIGO_DUPLICADO:FX-1,FX-2"), 409, "CODIGO_DUPLICADO"],
    ["23505 swap or chain on a unique index", err("23505", 'duplicate key value violates unique constraint "inventario_grupo_combinacion_activa_uniq"'), 409, "CONFLICTO"],
    ["23514 a check constraint", err("23514", 'new row for relation "inventario" violates check constraint "inventario_grupo_atributos"'), 400, "DATOS_INVALIDOS"],
    ["23503 a foreign key", err("23503", 'insert or update on table "inventario" violates foreign key constraint "inventario_grupo_id_fkey"'), 404, "NO_ENCONTRADO"],
    ["P0010 stock", err("P0010", "Stock insuficiente"), 400, "STOCK_INVALIDO"],
    ["P0011 depot", err("P0011", "La organizacion no tiene deposito principal"), 400, "DEPOSITO_INVALIDO"],
  ])("%s", (_t, error, status, code) => {
    const r = mapearErrorRpc(error)
    expect(r).not.toBeNull()
    expect(r!.status).toBe(status)
    expect(r!.body.code).toBe(code)
    expect(typeof r!.body.error).toBe("string")
    expect(r!.body.error.length).toBeGreaterThan(10)
  })

  it("never echoes the raw database message, a constraint or a token", () => {
    for (const e of [
      err("23505", 'duplicate key value violates unique constraint "inventario_org_codigo_active_uniq"'),
      err("22023", "PAYLOAD_INVALIDO: p_user is not a known user"),
      err("P0002", "NO_ENCONTRADO: group c1"),
      err("23514", 'violates check constraint "inventario_grupo_atributos"'),
    ]) {
      const texto = JSON.stringify(mapearErrorRpc(e)!.body)
      expect(texto).not.toMatch(/inventario_|PAYLOAD_INVALIDO:|p_user|NO_ENCONTRADO:|violates/)
    }
  })

  it("P0035 carries the offending codes as a list", () => {
    expect(mapearErrorRpc(err("P0035", "CODIGO_DUPLICADO:FX-1,FX-2"))!.body.codigos).toEqual(["FX-1", "FX-2"])
    expect(mapearErrorRpc(err("P0035", "CODIGO_DUPLICADO:PB7-RO"))!.body.codigos).toEqual(["PB7-RO"])
    expect(mapearErrorRpc(err("P0035", "CODIGO_DUPLICADO:PB8-S,PB8-X1,PB8-X2"))!.body.codigos).toEqual(["PB8-S", "PB8-X1", "PB8-X2"])
    expect(mapearErrorRpc(err("P0035", "CODIGO_DUPLICADO:FX-1,FX-2"))!.body.error).toMatch(/FX-1, FX-2/)
  })

  it("P0033 carries the item and the reserved units", () => {
    const r = mapearErrorRpc(err("P0033", RESERVADO))!
    expect(r.body).toMatchObject({ code: "STOCK_RESERVADO", variante: ID(5), unidades: 3 })
    expect(r.body.error).toMatch(/3/)
  })

  it("P0033 reads units of any length (12, 1500), not just one digit", () => {
    expect(mapearErrorRpc(err("P0033", `STOCK_RESERVADO:${ID(5)}:12`))!.body).toMatchObject({ variante: ID(5), unidades: 12 })
    expect(mapearErrorRpc(err("P0033", `STOCK_RESERVADO:${ID(5)}:1500`))!.body).toMatchObject({ unidades: 1500 })
    expect(mapearErrorRpc(err("P0033", `STOCK_RESERVADO:${ID(5)}:12`))!.body.error).toMatch(/12 unidades/)
  })

  it("P0031 and P0032 say which item (same idea as P0033), when the message names one", () => {
    expect(mapearErrorRpc(err("P0031", `ITEM_EN_OTRO_GRUPO: ${ID(2)}`))!.body).toMatchObject({ code: "ITEM_EN_OTRO_GRUPO", item: ID(2) })
    expect(mapearErrorRpc(err("P0032", `KIT_NO_PERMITIDO: ${ID(3)}`))!.body).toMatchObject({ code: "KIT_NO_PERMITIDO", item: ID(3) })
  })

  it("P0031 and P0032 without a single id in the message answer the same status and code, with no item", () => {
    for (const [codigo, mensaje, status] of [
      ["P0031", "ITEM_EN_OTRO_GRUPO: an archived id belongs to another group", 409],
      ["P0031", "ITEM_EN_OTRO_GRUPO", 409],
      ["P0032", "KIT_NO_PERMITIDO", 422],
    ] as const) {
      const r = mapearErrorRpc(err(codigo, mensaje))!
      expect(r.status).toBe(status)
      expect(r.body).not.toHaveProperty("item")
    }
  })

  it("P0002 keeps its generic message: it never names an id, whatever shape the message has", () => {
    for (const mensaje of [`NO_ENCONTRADO: item ${ID(1)}`, `NO_ENCONTRADO: ${ID(1)}`, "NO_ENCONTRADO"]) {
      const r = mapearErrorRpc(err("P0002", mensaje))!
      expect(r.body).toEqual({ error: "No encontramos el producto o el grupo de variantes", code: "NO_ENCONTRADO" })
    }
  })

  it("a stock-reserved message without the parts still answers 409", () => {
    const r = mapearErrorRpc(err("P0033", "STOCK_RESERVADO"))!
    expect(r.status).toBe(409)
    expect(r.body).not.toHaveProperty("variante")
    expect(r.body).not.toHaveProperty("unidades")
  })

  it("22023 miembros_faltantes is a 409 with the missing ids, so the form reloads", () => {
    const r = mapearErrorRpc(err("22023", `PAYLOAD_INVALIDO:miembros_faltantes:${ID(2)},${ID(3)}`))!
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: "MIEMBROS_FALTANTES", faltantes: [ID(2), ID(3)], recargar: true })
    expect(mapearErrorRpc(err("22023", `PAYLOAD_INVALIDO:miembros_faltantes:${ID(9)}`))!.body.faltantes).toEqual([ID(9)])
  })

  it("only the exact miembros_faltantes prefix is a 409; any other 22023 stays a 400", () => {
    for (const mensaje of [
      "PAYLOAD_INVALIDO: miembros_faltantes (not the token)",
      "PAYLOAD_INVALIDO: variantes with miembros_faltantes:x",
      "PAYLOAD_INVALIDO:miembros_faltantes:",
    ]) {
      const r = mapearErrorRpc(err("22023", mensaje))!
      expect(r.status).toBe(400)
      expect(r.body.code).toBe("PAYLOAD_INVALIDO")
    }
  })

  it("deadlock and serialization failures map to a retryable 409", () => {
    for (const e of [err("40P01", "deadlock detected"), err("40001", "could not serialize access due to concurrent update")]) {
      const r = mapearErrorRpc(e)!
      expect(r.status).toBe(409)
      expect(r.body).toMatchObject({ code: "REINTENTAR", reintentable: true })
    }
  })
})

describe("mapearErrorRpc: a missing migration is a 503, known codes come first", () => {
  it.each([
    ["42883 the function", err("42883", "function guardar_grupo_variantes(text, text, jsonb, jsonb, jsonb, jsonb, text) does not exist")],
    ["42P01 the table", err("42P01", 'relation "inventario_grupos" does not exist')],
    ["42703 a column", err("42703", "column inventario.grupo_id does not exist")],
    ["PGRST202 the function", err("PGRST202", "Could not find the function public.guardar_grupo_variantes(p_archivar, p_compartidos, p_deposito_inicial, p_grupo, p_org, p_user, p_variantes) in the schema cache")],
    ["PGRST200 a relationship", err("PGRST200", "Could not find a relationship between 'inventario' and 'inventario_grupos' in the schema cache")],
    ["PGRST204 a column in a write", err("PGRST204", "Could not find the 'atributos' column of 'inventario' in the schema cache")],
  ])("%s", (_t, error) => {
    const r = mapearErrorRpc(error)!
    expect(r.status).toBe(503)
    expect(r.body).toEqual({ error: "Variantes todavía no está disponible", code: "MIGRACION_PENDIENTE" })
  })

  it.each(["42883", "42P01", "42703", "PGRST202", "PGRST200", "PGRST204", "PGRST205"])(
    "the bare code %s is a 503 even when the message says nothing",
    (code) => {
      expect(mapearErrorRpc({ code })!.status).toBe(503)
      expect(mapearErrorRpc(err(code, ""))!.body.code).toBe("MIGRACION_PENDIENTE")
    }
  )

  it("a message-only schema cache error is a 503", () => {
    expect(mapearErrorRpc({ message: "relation does not exist" })!.status).toBe(503)
    expect(mapearErrorRpc(new Error("Could not find the table 'public.x' in the schema cache"))!.status).toBe(503)
  })

  it("ORDER: P0002 whose message says 'does not exist' is a 404, not a 503", () => {
    const r = mapearErrorRpc(err("P0002", "NO_ENCONTRADO: item cdead does not exist"))!
    expect(r.status).toBe(404)
    expect(r.body.code).toBe("NO_ENCONTRADO")
  })

  it.each([
    ["22023", 400],
    ["P0030", 409],
    ["P0031", 409],
    ["P0032", 422],
    ["P0033", 409],
    ["P0034", 422],
    ["P0035", 409],
    ["23505", 409],
    ["23514", 400],
    ["23503", 404],
    ["40P01", 409],
    ["P0010", 400],
    ["P0011", 400],
  ])("ORDER: %s with a 'does not exist' message keeps its own status %s", (code, status) => {
    expect(mapearErrorRpc(err(code, "relation x does not exist in the schema cache"))!.status).toBe(status)
  })

  it("answers null for everything else, so the route can answer 500", () => {
    expect(mapearErrorRpc(err("57014", "canceling statement due to statement timeout"))).toBeNull()
    expect(mapearErrorRpc(err("54000", "index row size exceeds btree maximum"))).toBeNull()
    expect(mapearErrorRpc(err("XX000", "internal error"))).toBeNull()
    expect(mapearErrorRpc(new Error("boom"))).toBeNull()
    expect(mapearErrorRpc(null)).toBeNull()
    expect(mapearErrorRpc(undefined)).toBeNull()
    expect(mapearErrorRpc("texto")).toBeNull()
  })
})

describe("esReintentable and conReintento", () => {
  it("only deadlock and serialization failure are retryable", () => {
    expect(esReintentable(err("40P01", "deadlock detected"))).toBe(true)
    expect(esReintentable(err("40001", "could not serialize"))).toBe(true)
    for (const code of ["23505", "P0030", "22023", "57014", "42883"]) expect(esReintentable(err(code, "x"))).toBe(false)
    expect(esReintentable(null)).toBe(false)
    expect(esReintentable(undefined)).toBe(false)
  })

  const resultado = (error: unknown, data: unknown = null) => ({ data, error })

  it("a success is returned after one call", async () => {
    const llamar = vi.fn().mockResolvedValue(resultado(null, { grupoId: "g" }))
    expect(await conReintento(llamar)).toEqual({ data: { grupoId: "g" }, error: null })
    expect(llamar).toHaveBeenCalledTimes(1)
  })

  it.each(["40P01", "40001"])("%s is retried exactly once and the second answer wins", async (code) => {
    const llamar = vi
      .fn()
      .mockResolvedValueOnce(resultado(err(code, "deadlock detected")))
      .mockResolvedValueOnce(resultado(null, { grupoId: "g" }))
    expect(await conReintento(llamar)).toEqual({ data: { grupoId: "g" }, error: null })
    expect(llamar).toHaveBeenCalledTimes(2)
  })

  it("two deadlocks in a row stop at two calls and return the error", async () => {
    const llamar = vi.fn().mockResolvedValue(resultado(err("40P01", "deadlock detected")))
    const r = await conReintento(llamar)
    expect(llamar).toHaveBeenCalledTimes(2)
    expect(r.error).toMatchObject({ code: "40P01" })
  })

  it("a retry that meets another error returns that error without a third call", async () => {
    const llamar = vi
      .fn()
      .mockResolvedValueOnce(resultado(err("40P01", "deadlock detected")))
      .mockResolvedValueOnce(resultado(err("P0030", "COMBINACION_DUPLICADA")))
    const r = await conReintento(llamar)
    expect(llamar).toHaveBeenCalledTimes(2)
    expect(r.error).toMatchObject({ code: "P0030" })
  })

  it.each(["P0030", "23505", "22023", "57014"])("%s is not retried", async (code) => {
    const llamar = vi.fn().mockResolvedValue(resultado(err(code, "x")))
    await conReintento(llamar)
    expect(llamar).toHaveBeenCalledTimes(1)
  })
})

describe("migracionPendiente and respuestaDeError", () => {
  it("migracionPendiente is the controlled 503 the group routes share", async () => {
    const res = migracionPendiente()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: "Variantes todavía no está disponible", code: "MIGRACION_PENDIENTE" })
  })

  it("respuestaDeError turns a mapped error into a response and an unknown one into null", async () => {
    const res = respuestaDeError(err("P0035", "CODIGO_DUPLICADO:FX-1"))!
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "CODIGO_DUPLICADO", codigos: ["FX-1"] })
    expect(respuestaDeError(err("57014", "timeout"))).toBeNull()
  })
})

describe("respuestaDeValidacion", () => {
  const INGLES = /Expected|Required|received|Invalid|must |Unrecognized|Number |String |Array |finite|zod/i
  const issuesDe = (p: Payload) => {
    const r = guardarGrupoSchema.safeParse(p)
    if (r.success) throw new Error("expected a rejection")
    return r.error
  }

  it("is a 400 with the first message in Spanish, a machine code and the field", async () => {
    const res = respuestaDeValidacion(issuesDe(conFila(1, { precioVenta: -1 })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "El precio no puede ser negativo", code: "PAYLOAD_INVALIDO", campo: "variantes.1.precioVenta" })
  })

  it("names the offending key of an unrecognized-keys issue in the field", async () => {
    const res = respuestaDeValidacion(issuesDe(conFila(0, { imagenUrl: "x" })))
    const body = await res.json()
    expect(body.campo).toBe("variantes.0.imagenUrl")
    expect(body.error).toBe("Hay datos que no se pueden guardar con las variantes")
    expect(JSON.stringify(body)).not.toMatch(/Unrecognized|zod/i)
  })

  it("lists every key when several are unknown, and a root-level key has no prefix", async () => {
    expect((await respuestaDeValidacion(issuesDe({ ...base(), imagenUrl: "x", organizationId: "o" })).json()).campo).toBe("imagenUrl,organizationId")
  })

  // Zod's own messages are English ("Expected object, received null"). Whatever the wrong
  // type, the body carries Spanish copy and still points at the field.
  it.each([
    ["a null body", null, "", "Los datos no tienen el formato esperado"],
    ["a missing grupo", { variantes: [] }, "grupo", "Falta un dato requerido"],
    ["a null grupo", { ...base(), grupo: null }, "grupo", "Los datos no tienen el formato esperado"],
    ["variantes as a text", { ...base(), variantes: "x" }, "variantes", "Tiene que ser una lista"],
    ["a text price", conFila(0, { precioVenta: "10" }), "variantes.0.precioVenta", "Tiene que ser un número"],
    ["a numeric code", conFila(0, { codigo: 5 }), "variantes.0.codigo", "Tiene que ser un texto"],
    ["a text flag", { ...base(), grupo: { ...base().grupo, renombrar: "si" } }, "grupo.renombrar", "Tiene que ser sí o no"],
    ["a numeric depositoId", { ...base(), depositoId: 5 }, "depositoId", "Tiene que ser un texto"],
    ["an array atributos with null", conFila(0, { atributos: [null] }), "variantes.0.atributos.0", "Los datos no tienen el formato esperado"],
  ])("%s: Spanish message, the field is kept", async (_t, cuerpo, campo, mensaje) => {
    const body = await respuestaDeValidacion(issuesDe(cuerpo as Payload)).json()
    expect(body).toEqual({ error: mensaje, code: "PAYLOAD_INVALIDO", campo })
    expect(body.error).not.toMatch(INGLES)
  })

  it("no real wrong-typed or oversized body leaks an English message", async () => {
    const cuerpos: unknown[] = [
      5, "x", [], {},
      { ...base(), archivar: "x" },
      { ...base(), compartidos: 5 },
      conFila(0, { stockMinimo: "a" }),
      conFila(0, { id: 5 }),
      conFila(0, { atributos: "x" }),
      { ...base(), compartidos: { trackeaLotes: "x" } },
      { ...base(), compartidos: { diasGarantiaDefault: "7" } },
      { ...base(), depositoId: "d".repeat(101) },
      { ...base(), archivar: [ID(1).repeat(5)] },
    ]
    for (const cuerpo of cuerpos) {
      const body = await respuestaDeValidacion(issuesDe(cuerpo as Payload)).json()
      expect(typeof body.error).toBe("string")
      expect(body.error.length).toBeGreaterThan(5)
      expect(body.error).not.toMatch(INGLES)
    }
  })

  it("an error without issues still answers a 400 with generic Spanish copy", async () => {
    const res = respuestaDeValidacion(new z.ZodError([]))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Los datos de las variantes no son válidos", code: "PAYLOAD_INVALIDO", campo: "" })
  })

  it("uses the first issue only", async () => {
    const p = conFila(0, { precioVenta: -1, stockInicial: 1.5 })
    expect((await respuestaDeValidacion(issuesDe(p)).json()).campo).toBe("variantes.0.precioVenta")
  })
})
