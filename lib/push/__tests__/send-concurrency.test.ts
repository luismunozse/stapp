import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { sendPushToUsers } from "../send"

// Sin suscripciones: sendPushToUser hace sus dos selects y vuelve. Medimos
// cuantos selects hay abiertos a la vez para inferir cuantos usuarios van en vuelo.
function mockSelectLento() {
  let enVuelo = 0
  let maximo = 0
  vi.mocked(supabaseAdmin.from).mockImplementation(() => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      then: (resolve: (v: unknown) => void) => {
        enVuelo++
        maximo = Math.max(maximo, enVuelo)
        setTimeout(() => {
          enVuelo--
          resolve({ data: [], error: null })
        }, 5)
      },
    }
    return chain
  })
  return () => maximo
}

describe("sendPushToUsers concurrencia", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sin opciones procesa a todos en paralelo (comportamiento previo)", async () => {
    const maximo = mockSelectLento()
    await sendPushToUsers(Array.from({ length: 30 }, (_, i) => `u${i}`), { title: "t", body: "b" })
    expect(maximo()).toBeGreaterThanOrEqual(30)
  })

  it("con concurrency=3 nunca hay mas de 3 usuarios en vuelo", async () => {
    const maximo = mockSelectLento()
    await sendPushToUsers(
      Array.from({ length: 30 }, (_, i) => `u${i}`),
      { title: "t", body: "b" },
      { concurrency: 3 }
    )
    // Cada usuario abre 2 selects a la vez (web + fcm): tope 3 * 2.
    expect(maximo()).toBeLessThanOrEqual(6)
    expect(maximo()).toBeGreaterThan(0)
  })

  it("con concurrency el resultado sigue sumando a todos los usuarios", async () => {
    mockSelectLento()
    const r = await sendPushToUsers(["a", "b", "c", "d"], { title: "t", body: "b" }, { concurrency: 2 })
    expect(r).toEqual({ sent: 0, failed: 0, skipped: 0, byTransport: { web: 0, fcm: 0 }, errors: [] })
  })

  describe("aislamiento de fallas por usuario", () => {
    function mockUnoFalla() {
      vi.mocked(supabaseAdmin.from).mockImplementation(() => {
        let userId = ""
        const chain: any = {
          select: () => chain,
          eq: (col: string, v: string) => {
            if (col === "user_id") userId = v
            return chain
          },
          then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
            if (userId === "malo") reject(new Error("db caida"))
            else resolve({ data: [], error: null })
          },
        }
        return chain
      })
    }

    it.each([[undefined], [2]])("un usuario que tira cuenta 1 fallido y no rechaza (concurrency=%s)", async (concurrency) => {
      mockUnoFalla()
      const r = await sendPushToUsers(["a", "malo", "c"], { title: "t", body: "b" }, concurrency ? { concurrency } : {})
      expect(r.failed).toBe(1)
      expect(r.errors.join(" ")).toContain("db caida")
    })
  })
})
