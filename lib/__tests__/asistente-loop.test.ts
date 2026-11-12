import { describe, it, expect, vi } from "vitest"
import { ejecutarAsistente, MAX_RONDAS, RESPUESTA_RECHAZADA } from "@/lib/asistente/loop"
import type { Herramienta } from "@/lib/asistente/herramientas"

const ctx = {
  actor: { organizationId: "org-1", userId: "u-1", role: "ADMIN", sucursalId: null },
  moneda: "ARS",
  zonaHoraria: "America/Argentina/Buenos_Aires",
  filtroLectura: { verTodas: true, sucursalId: null },
}
const uso = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }

const texto = (t: string) => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage: uso })
const pideHerramienta = (id: string, name: string, input: unknown) => ({
  content: [
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "tool_use", id, name, input },
  ],
  stop_reason: "tool_use",
  usage: uso,
})

function herramienta(nombre: string, ejecutar: Herramienta["ejecutar"]): Herramienta {
  return {
    definicion: { name: nombre, description: "x", input_schema: { type: "object", properties: {} } },
    disponible: () => true,
    ejecutar,
  }
}

function cliente(...respuestas: any[]) {
  const create = vi.fn()
  for (const r of respuestas) create.mockResolvedValueOnce(r)
  return { create, client: { messages: { create } } as any }
}

const base = { system: "SYS", historial: [], mensaje: "hola", ctx }

describe("ejecutarAsistente", () => {
  it("sin herramientas responde en una sola llamada y no manda tools", async () => {
    const { client, create } = cliente(texto("Hola!"))
    const r = await ejecutarAsistente({ ...base, client, herramientas: [] })
    expect(r.texto).toBe("Hola!")
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0].tools).toBeUndefined()
    expect(r.llamadas).toEqual([])
  })

  it("ejecuta la herramienta, devuelve el resultado y suma el uso de las dos rondas", async () => {
    const ejecutar = vi.fn().mockResolvedValue({ datos: { estado: "Reparado" }, filas: 1 })
    const { client, create } = cliente(pideHerramienta("t1", "ver_orden", { numero: "12" }), texto("Está reparada."))
    const r = await ejecutarAsistente({ ...base, client, herramientas: [herramienta("ver_orden", ejecutar)] })

    expect(r.texto).toBe("Está reparada.")
    expect(ejecutar).toHaveBeenCalledWith({ numero: "12" }, ctx)
    expect(r.uso).toEqual({ input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 })
    expect(r.llamadas).toEqual([expect.objectContaining({ nombre: "ver_orden", filas: 1 })])

    const segunda = create.mock.calls[1][0].messages
    // El turno del asistente vuelve completo, con el bloque de thinking intacto.
    expect(segunda[1]).toEqual({ role: "assistant", content: pideHerramienta("t1", "ver_orden", {}).content.map((b: any) => b.type === "tool_use" ? { ...b, input: { numero: "12" } } : b) })
    expect(segunda[2].content).toEqual([{ type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ estado: "Reparado" }) }])
  })

  it("una herramienta que no se ofreció al usuario responde is_error y no se ejecuta nada", async () => {
    const { client, create } = cliente(pideHerramienta("t1", "resumen_caja", {}), texto("No tengo acceso."))
    const r = await ejecutarAsistente({ ...base, client, herramientas: [herramienta("ver_orden", vi.fn())] })
    const resultado = create.mock.calls[1][0].messages[2].content[0]
    expect(resultado.is_error).toBe(true)
    expect(r.llamadas[0]).toMatchObject({ nombre: "resumen_caja", error: "no disponible" })
  })

  it("si la herramienta falla, el modelo recibe un error genérico y el detalle queda en el registro", async () => {
    const ejecutar = vi.fn().mockRejectedValue(new Error("detalle interno de la base"))
    const { client, create } = cliente(pideHerramienta("t1", "ver_orden", {}), texto("No pude."))
    const r = await ejecutarAsistente({ ...base, client, herramientas: [herramienta("ver_orden", ejecutar)] })
    const resultado = create.mock.calls[1][0].messages[2].content[0]
    expect(resultado.is_error).toBe(true)
    expect(resultado.content).not.toContain("detalle interno")
    expect(r.llamadas[0].error).toBe("detalle interno de la base")
  })

  it("un rechazo del modelo devuelve un mensaje fijo", async () => {
    const { client } = cliente({ content: [], stop_reason: "refusal", usage: uso })
    const r = await ejecutarAsistente({ ...base, client, herramientas: [] })
    expect(r.texto).toBe(RESPUESTA_RECHAZADA)
  })

  it(`corta a las ${MAX_RONDAS} rondas: la última llamada prohíbe herramientas`, async () => {
    const ejecutar = vi.fn().mockResolvedValue({ datos: {}, filas: 0 })
    const respuestas = Array.from({ length: MAX_RONDAS }, (_, i) => pideHerramienta(`t${i}`, "ver_orden", {}))
    const { client, create } = cliente(...respuestas, texto("Con lo que tengo: ..."))
    const r = await ejecutarAsistente({ ...base, client, herramientas: [herramienta("ver_orden", ejecutar)] })

    expect(create).toHaveBeenCalledTimes(MAX_RONDAS + 1)
    expect(create.mock.calls[MAX_RONDAS][0].tool_choice).toEqual({ type: "none" })
    expect(create.mock.calls[0][0].tool_choice).toBeUndefined()
    expect(r.texto).toBe("Con lo que tengo: ...")
  })
})
