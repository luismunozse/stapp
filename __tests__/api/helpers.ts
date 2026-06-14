import { vi } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"

// ─── Auth mock helpers ───
// These configure the globally-mocked `auth()` from vitest.setup.ts.
// `requireAuth()` internally calls `auth()`, so by controlling what
// `auth()` returns we control auth behavior in all API routes.

export function mockAuthSuccess(overrides?: {
  organizationId?: string
  userId?: string
  role?: string
}) {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: overrides?.userId || "user-1",
      organizationId: overrides?.organizationId || "org-1",
      role: overrides?.role || "ADMIN",
      email: "test@test.com",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

export function mockAuthError() {
  vi.mocked(auth).mockResolvedValue(null as any)
}

// ─── Supabase mock helpers ───

type ChainMock = Record<string, ReturnType<typeof vi.fn>> & {
  then?: (resolve: any, reject?: any) => any
  catch?: (reject: any) => any
}

/**
 * Create a chainable Supabase query mock.
 * All methods return `this` for chaining.
 * `.single()` resolves with { data, error }.
 * Awaiting the chain directly (without .single()) also resolves with { data, error }.
 */
export function createChainMock(finalData: any = null, finalError: any = null, count?: number): ChainMock {
  const result: any = { data: finalData, error: finalError }
  if (count !== undefined) result.count = count

  const chain: any = {}
  const methods = [
    "select", "insert", "update", "upsert", "delete",
    "eq", "neq", "not", "gte", "lte", "gt", "lt",
    "or", "in", "is", "textSearch",
    "order", "limit", "range",
    "maybeSingle",
  ]

  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain)
  }
  chain.single = vi.fn().mockResolvedValue(result)

  // Make chain thenable (for queries that don't use .single())
  chain.then = (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject)
  chain.catch = (reject: any) => Promise.resolve(result).catch(reject)

  return chain
}

/**
 * Configure supabaseAdmin.from() to return specific chains per table.
 * Tables not in the map return a default error chain.
 */
export function mockSupabaseFrom(tableChains: Record<string, ChainMock>) {
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    return (tableChains[table] || createChainMock(null, { message: `No mock for table: ${table}` })) as any
  })
}

// ─── Request helpers ───

export function createGetRequest(url: string = "http://localhost:3000/api/test"): Request {
  return new Request(url, { method: "GET" })
}

export function createPostRequest(body: any, url: string = "http://localhost:3000/api/test"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// ─── Response helpers ───

export async function parseResponse(response: Response) {
  const json = await response.json()
  return { status: response.status, body: json }
}
