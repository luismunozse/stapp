import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cancelCreemSubscription } from "@/lib/creem"

const fetchMock = vi.fn()

describe("cancelCreemSubscription", () => {
  beforeEach(() => {
    vi.stubEnv("CREEM_API_KEY", "creem_test_key")
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("cancela al final del período (mode scheduled)", async () => {
    fetchMock.mockResolvedValue({ ok: true })

    await cancelCreemSubscription("sub_123")

    expect(fetchMock).toHaveBeenCalledWith(
      "https://test-api.creem.io/v1/subscriptions/sub_123/cancel",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "creem_test_key" }),
        body: JSON.stringify({ mode: "scheduled", onExecute: "cancel" }),
      })
    )
  })

  it("es idempotente: si Creem rechaza pero la suscripción ya está cancelada, no lanza", async () => {
    // Reintento tras fallo parcial (Creem canceló pero nuestra base no se
    // actualizó): el segundo cancel devuelve 400 y no debe romper el flujo.
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => "already canceled" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "sub_123", status: "scheduled_cancel" }),
      })

    await expect(cancelCreemSubscription("sub_123")).resolves.toBeUndefined()
  })

  it("lanza si Creem rechaza y la suscripción sigue activa", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "sub_123", status: "active" }),
      })

    await expect(cancelCreemSubscription("sub_123")).rejects.toThrow(/Creem cancel error/)
  })
})
