import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { rpc: vi.fn() } }))

import { supabaseAdmin } from "@/lib/supabase"
import { withLease, LeaseAcquisitionError, wsaaLockKey, emisionLockKey } from "@/lib/facturacion/arca/lease"

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

describe("withLease", () => {
  beforeEach(() => vi.clearAllMocks())

  it("acquires on the first try and runs fn, then releases", async () => {
    mockRpc({
      facturacion_lease_acquire: () => ({ data: true, error: null }),
      facturacion_lease_release: () => ({ data: true, error: null }),
    })

    const result = await withLease(
      { lockKey: "emis:org1:1:6", organizationId: "org1", ttlSeconds: 90, sleep: noopSleep },
      async () => "ok"
    )

    expect(result).toBe("ok")
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "facturacion_lease_acquire",
      expect.objectContaining({ p_lock_key: "emis:org1:1:6", p_org_id: "org1", p_ttl_seconds: 90 })
    )
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("facturacion_lease_release", expect.any(Object))
  })

  it("does not block: acquire is a single non-blocking RPC call per attempt", async () => {
    let acquireCalls = 0
    mockRpc({
      facturacion_lease_acquire: () => {
        acquireCalls++
        return { data: true, error: null }
      },
      facturacion_lease_release: () => ({ data: true, error: null }),
    })
    await withLease({ lockKey: "k", organizationId: "org1", ttlSeconds: 90, sleep: noopSleep }, async () => "ok")
    expect(acquireCalls).toBe(1)
  })

  it("retries with jitter and succeeds on a later attempt", async () => {
    let calls = 0
    mockRpc({
      facturacion_lease_acquire: () => {
        calls++
        return { data: calls >= 3, error: null }
      },
      facturacion_lease_release: () => ({ data: true, error: null }),
    })
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await withLease({ lockKey: "k", organizationId: "org1", ttlSeconds: 90, sleep }, async () => "ok")

    expect(result).toBe("ok")
    expect(calls).toBe(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    for (const call of sleep.mock.calls) {
      expect(call[0]).toBeGreaterThanOrEqual(200)
      expect(call[0]).toBeLessThanOrEqual(2000)
    }
  })

  it("throws LeaseAcquisitionError after exhausting 5 retries, never calling fn", async () => {
    let acquireCalls = 0
    mockRpc({
      facturacion_lease_acquire: () => {
        acquireCalls++
        return { data: false, error: null }
      },
      facturacion_lease_release: () => ({ data: true, error: null }),
    })
    const fn = vi.fn()

    await expect(
      withLease({ lockKey: "k", organizationId: "org1", ttlSeconds: 90, sleep: noopSleep }, fn)
    ).rejects.toThrow(LeaseAcquisitionError)

    expect(fn).not.toHaveBeenCalled()
    expect(acquireCalls).toBe(5)
  })

  it("uses the same fencing holder for acquire and release", async () => {
    let acquireHolder: string | undefined
    let releaseHolder: string | undefined
    mockRpc({
      facturacion_lease_acquire: (args) => {
        acquireHolder = args.p_holder
        return { data: true, error: null }
      },
      facturacion_lease_release: (args) => {
        releaseHolder = args.p_holder
        return { data: true, error: null }
      },
    })

    await withLease({ lockKey: "k", organizationId: "org1", ttlSeconds: 90, sleep: noopSleep }, async () => "ok")

    expect(acquireHolder).toBeTruthy()
    expect(acquireHolder).toBe(releaseHolder)
  })

  it("releases in a finally even when fn throws, and propagates the original error", async () => {
    mockRpc({
      facturacion_lease_acquire: () => ({ data: true, error: null }),
      facturacion_lease_release: () => ({ data: true, error: null }),
    })

    await expect(
      withLease({ lockKey: "k", organizationId: "org1", ttlSeconds: 90, sleep: noopSleep }, async () => {
        throw new Error("boom")
      })
    ).rejects.toThrow("boom")

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("facturacion_lease_release", expect.any(Object))
  })

  it("does not throw when release reports the lease was already reassigned (fenced)", async () => {
    mockRpc({
      facturacion_lease_acquire: () => ({ data: true, error: null }),
      facturacion_lease_release: () => ({ data: false, error: null }),
    })

    const result = await withLease(
      { lockKey: "k", organizationId: "org1", ttlSeconds: 90, sleep: noopSleep },
      async () => "ok"
    )
    expect(result).toBe("ok")
  })

  it("throws immediately (no retry) on an RPC transport error during acquire", async () => {
    let acquireCalls = 0
    mockRpc({
      facturacion_lease_acquire: () => {
        acquireCalls++
        return { data: null, error: { message: "connection refused" } }
      },
      facturacion_lease_release: () => ({ data: true, error: null }),
    })

    await expect(
      withLease({ lockKey: "k", organizationId: "org1", ttlSeconds: 90, sleep: noopSleep }, async () => "ok")
    ).rejects.toThrow(/connection refused/)
    expect(acquireCalls).toBe(1)
  })
})

describe("lock key builders (design ADR-02 key derivation)", () => {
  it("wsaaLockKey derives per org/cuit/service/environment", () => {
    expect(wsaaLockKey("org1", "20111111112", "wsfe", false)).toBe("wsaa:org1:20111111112:wsfe:h")
    expect(wsaaLockKey("org1", "20111111112", "wsfe", true)).toBe("wsaa:org1:20111111112:wsfe:p")
  })

  it("emisionLockKey derives per org/punto de venta/tipo", () => {
    expect(emisionLockKey("org1", 3, 6)).toBe("emis:org1:3:6")
  })
})
