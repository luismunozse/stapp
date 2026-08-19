import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"

vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } }))

import { supabaseAdmin } from "@/lib/supabase"
import { encryptSecret, decryptSecret } from "@/lib/facturacion/crypto"
import {
  readWsaaTicket,
  writeWsaaTicket,
  renewWsaaTicket,
  WsaaLoginRateLimitedError,
  WsaaLoginUnavailableError,
} from "@/lib/facturacion/arca/wsaa-ticket-store"
import { LeaseAcquisitionError } from "@/lib/facturacion/arca/lease"

beforeAll(() => {
  process.env.FACTURACION_ENCRYPTION_KEY = "test-key-at-least-32-chars-long-xxxxx"
})

const key = { organizationId: "org1", cuit: "20111111112", service: "wsfe", production: false }

function selectChain(result: { data: any; error: any }) {
  const chain: any = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(async () => result)
  return chain
}

function upsertChain(capture: { payload?: any; options?: any }, result: { error: any } = { error: null }) {
  return {
    upsert: vi.fn(async (payload: any, options: any) => {
      capture.payload = payload
      capture.options = options
      return result
    }),
  }
}

function updateChain(capture: { payload?: any }, result: { error: any } = { error: null }) {
  const chain: any = {}
  chain.update = vi.fn((payload: any) => {
    capture.payload = payload
    return chain
  })
  chain.eq = vi.fn(() => chain)
  chain.then = (resolve: any) => Promise.resolve(result).then(resolve)
  return chain
}

function noopSleep(): Promise<void> {
  return Promise.resolve()
}

function mockRpc(handlers: Record<string, (args: any) => { data: any; error: any }>) {
  ;(supabaseAdmin.rpc as any).mockImplementation((fnName: string, args: any) => {
    const handler = handlers[fnName]
    if (!handler) throw new Error(`unexpected rpc call: ${fnName}`)
    return Promise.resolve(handler(args))
  })
}

describe("readWsaaTicket", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns null when no row exists", async () => {
    ;(supabaseAdmin.from as any).mockReturnValueOnce(selectChain({ data: null, error: null }))
    expect(await readWsaaTicket(key)).toBeNull()
  })

  it("returns null (miss) when expires_at is within the 10-minute margin", async () => {
    const soon = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    ;(supabaseAdmin.from as any).mockReturnValueOnce(
      selectChain({
        data: { token_enc: encryptSecret("tok"), sign_enc: encryptSecret("sig"), expires_at: soon, generated_at: null },
        error: null,
      })
    )
    expect(await readWsaaTicket(key)).toBeNull()
  })

  it("returns the decrypted ticket when valid beyond the margin", async () => {
    const later = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    ;(supabaseAdmin.from as any).mockReturnValueOnce(
      selectChain({
        data: { token_enc: encryptSecret("tok"), sign_enc: encryptSecret("sig"), expires_at: later, generated_at: "2026-01-01T00:00:00.000Z" },
        error: null,
      })
    )
    const ticket = await readWsaaTicket(key)
    expect(ticket).toEqual({ token: "tok", sign: "sig", expiresAt: later, generatedAt: "2026-01-01T00:00:00.000Z" })
  })

  it("scopes the lookup by organization, cuit, service and production", async () => {
    const chain = selectChain({ data: null, error: null })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(chain)
    await readWsaaTicket(key)
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org1")
    expect(chain.eq).toHaveBeenCalledWith("cuit", "20111111112")
    expect(chain.eq).toHaveBeenCalledWith("service", "wsfe")
    expect(chain.eq).toHaveBeenCalledWith("production", false)
  })

  it("throws a descriptive error when the read fails", async () => {
    ;(supabaseAdmin.from as any).mockReturnValueOnce(selectChain({ data: null, error: { message: "db down" } }))
    await expect(readWsaaTicket(key)).rejects.toThrow(/db down/)
  })
})

describe("writeWsaaTicket", () => {
  beforeEach(() => vi.clearAllMocks())

  it("encrypts token/sign and upserts on the composite key", async () => {
    const capture: any = {}
    ;(supabaseAdmin.from as any).mockReturnValueOnce(upsertChain(capture))
    const expiresAt = new Date(Date.now() + 3600_000).toISOString()

    await writeWsaaTicket(key, { token: "tok", sign: "sig", expiresAt })

    expect(capture.payload.organization_id).toBe("org1")
    expect(capture.payload.cuit).toBe("20111111112")
    expect(capture.payload.service).toBe("wsfe")
    expect(capture.payload.production).toBe(false)
    expect(capture.payload.expires_at).toBe(expiresAt)
    expect(decryptSecret(capture.payload.token_enc)).toBe("tok")
    expect(decryptSecret(capture.payload.sign_enc)).toBe("sig")
    expect(capture.options).toEqual(expect.objectContaining({ onConflict: "organization_id,cuit,service,production" }))
  })

  it("throws when the upsert fails", async () => {
    ;(supabaseAdmin.from as any).mockReturnValueOnce(upsertChain({}, { error: { message: "constraint violation" } }))
    await expect(
      writeWsaaTicket(key, { token: "tok", sign: "sig", expiresAt: new Date().toISOString() })
    ).rejects.toThrow(/constraint violation/)
  })
})

describe("renewWsaaTicket (double-checked locking, design ADR-05)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns the cached ticket without acquiring a lease when still valid", async () => {
    const later = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    ;(supabaseAdmin.from as any).mockReturnValueOnce(
      selectChain({ data: { token_enc: encryptSecret("tok"), sign_enc: encryptSecret("sig"), expires_at: later, generated_at: null }, error: null })
    )
    const login = vi.fn()

    const ticket = await renewWsaaTicket({ key, login, sleep: noopSleep })

    expect(ticket.token).toBe("tok")
    expect(login).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("logs in and persists when stale and no prior login attempt is on record", async () => {
    const stampCapture: any = {}
    const upsertCapture: any = {}
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(selectChain({ data: null, error: null })) // 1. initial read: miss
      .mockReturnValueOnce(selectChain({ data: null, error: null })) // 3. re-read after lease: still miss
      .mockReturnValueOnce(selectChain({ data: null, error: null })) // 4. floor check: no row yet
      .mockReturnValueOnce(updateChain(stampCapture)) // stamp ultimo_login_intento_at
      .mockReturnValueOnce(upsertChain(upsertCapture)) // persist new ticket

    mockRpc({
      facturacion_lease_acquire: () => ({ data: true, error: null }),
      facturacion_lease_release: () => ({ data: true, error: null }),
    })

    const expiresAt = new Date(Date.now() + 3600_000).toISOString()
    const login = vi.fn().mockResolvedValue({ token: "new-tok", sign: "new-sig", expiresAt })

    const ticket = await renewWsaaTicket({ key, login, sleep: noopSleep })

    expect(login).toHaveBeenCalledTimes(1)
    expect(ticket.token).toBe("new-tok")
    expect(decryptSecret(upsertCapture.payload.token_enc)).toBe("new-tok")
    expect(stampCapture.payload.ultimo_login_intento_at).toBeTruthy()
  })

  it("throws WsaaLoginRateLimitedError and never calls login() when inside the 60s floor", async () => {
    const recentAttempt = new Date(Date.now() - 5000).toISOString() // 5s ago < 60s floor
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(selectChain({ data: null, error: null })) // initial read: miss
      .mockReturnValueOnce(selectChain({ data: null, error: null })) // re-read: still miss
      .mockReturnValueOnce(
        selectChain({
          data: { token_enc: "x", sign_enc: "x", expires_at: new Date(0).toISOString(), ultimo_login_intento_at: recentAttempt },
          error: null,
        })
      ) // floor check: recent attempt on record

    mockRpc({
      facturacion_lease_acquire: () => ({ data: true, error: null }),
      facturacion_lease_release: () => ({ data: true, error: null }),
    })

    const login = vi.fn()

    await expect(renewWsaaTicket({ key, login, sleep: noopSleep })).rejects.toThrow(WsaaLoginRateLimitedError)
    expect(login).not.toHaveBeenCalled()
  })

  it("falls back to sleep-and-reread when the lease cannot be acquired, and returns another worker's fresh ticket", async () => {
    const later = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(selectChain({ data: null, error: null })) // initial read: miss
      .mockReturnValueOnce(selectChain({ data: null, error: null })) // reread attempt 1: still miss
      .mockReturnValueOnce(
        selectChain({ data: { token_enc: encryptSecret("won-tok"), sign_enc: encryptSecret("won-sig"), expires_at: later, generated_at: null }, error: null })
      ) // reread attempt 2: another worker published a fresh ticket

    mockRpc({
      facturacion_lease_acquire: () => ({ data: false, error: null }), // always busy -> exhausts withLease's own retries
      facturacion_lease_release: () => ({ data: true, error: null }),
    })

    const login = vi.fn()

    const ticket = await renewWsaaTicket({ key, login, sleep: noopSleep, rereadAttempts: 3, rereadDelayMs: 1 })

    expect(ticket.token).toBe("won-tok")
    expect(login).not.toHaveBeenCalled()
  })

  it("throws WsaaLoginUnavailableError when the lease never frees up and no ticket ever appears", async () => {
    ;(supabaseAdmin.from as any).mockReturnValue(selectChain({ data: null, error: null }))

    mockRpc({
      facturacion_lease_acquire: () => ({ data: false, error: null }),
      facturacion_lease_release: () => ({ data: true, error: null }),
    })

    const login = vi.fn()

    await expect(
      renewWsaaTicket({ key, login, sleep: noopSleep, rereadAttempts: 2, rereadDelayMs: 1 })
    ).rejects.toThrow(WsaaLoginUnavailableError)
    expect(login).not.toHaveBeenCalled()
  })

  it("propagates a non-lease error (e.g. login() failure) instead of swallowing it as unavailable", async () => {
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(selectChain({ data: null, error: null }))
      .mockReturnValueOnce(selectChain({ data: null, error: null }))
      .mockReturnValueOnce(selectChain({ data: null, error: null }))
      .mockReturnValueOnce(updateChain({}))

    mockRpc({
      facturacion_lease_acquire: () => ({ data: true, error: null }),
      facturacion_lease_release: () => ({ data: true, error: null }),
    })

    const login = vi.fn().mockRejectedValue(new Error("AFIP WSAA login rejected"))

    await expect(renewWsaaTicket({ key, login, sleep: noopSleep })).rejects.toThrow("AFIP WSAA login rejected")
  })
})

describe("error classes", () => {
  it("LeaseAcquisitionError is not confused with the WSAA-specific errors", () => {
    expect(new WsaaLoginRateLimitedError(key)).not.toBeInstanceOf(LeaseAcquisitionError)
    expect(new WsaaLoginUnavailableError(key)).not.toBeInstanceOf(LeaseAcquisitionError)
  })
})
