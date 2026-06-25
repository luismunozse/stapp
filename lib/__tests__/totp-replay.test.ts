import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabaseAdmin } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a fluent Supabase query chain whose TERMINAL method resolves to
 * `{ data, error }`. Intermediate methods (select, insert, update, delete, eq,
 * lt, single…) all return `this` so they can be chained freely.
 */
function makeChain(resolved: { data?: any; error?: any }) {
  const chain: Record<string, any> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(resolved),
  }
  // Make the chain itself thenable so `await chain` resolves (used by insert/delete paths)
  chain.then = (resolve: (v: any) => any) => Promise.resolve(resolved).then(resolve)
  return chain
}

// ---------------------------------------------------------------------------
// TOTP secret setup
// We generate a deterministic TOTP code at test-run time so the 6-digit
// branch in verifyUserTotpCode is exercised without mocking internals.
// ---------------------------------------------------------------------------

import * as OTPAuth from 'otpauth'
import { encryptSecret } from '../totp'

process.env.NEXTAUTH_SECRET = 'test-secret-at-least-32-chars-long!!'

function makeTotpSecret() {
  const totp = new OTPAuth.TOTP({
    issuer: 'STApp',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  })
  return totp.secret.base32
}

function generateCurrentCode(base32Secret: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: 'STApp',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(base32Secret),
  })
  return totp.generate()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verifyUserTotpCode — replay attack prevention', () => {
  const userId = 'user-cuid-abc123'
  let base32Secret: string
  let encryptedSecret: string

  beforeEach(async () => {
    vi.clearAllMocks()
    base32Secret = makeTotpSecret()
    encryptedSecret = encryptSecret(base32Secret)
  })

  it('TEST 1 — first use: valid code with successful insert returns { valid: true }', async () => {
    const validCode = generateCurrentCode(base32Secret)

    const usersChain = makeChain({
      data: {
        totp_secret: encryptedSecret,
        totp_enabled: true,
        totp_backup_codes: [],
      },
      error: null,
    })

    // delete (purge) resolves ok
    const purgeChain = makeChain({ data: null, error: null })

    // insert resolves with no error (first use)
    const insertChain = makeChain({ data: null, error: null })

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(usersChain as any)   // users select
      .mockReturnValueOnce(purgeChain as any)   // totp_used_codes delete
      .mockReturnValueOnce(insertChain as any)  // totp_used_codes insert

    const { verifyUserTotpCode } = await import('../totp')
    const result = await verifyUserTotpCode(userId, validCode)

    expect(result).toEqual({ valid: true })
  })

  it('TEST 2 — replay: same code, insert returns 23505 unique violation → { valid: false }', async () => {
    const validCode = generateCurrentCode(base32Secret)

    const usersChain = makeChain({
      data: {
        totp_secret: encryptedSecret,
        totp_enabled: true,
        totp_backup_codes: [],
      },
      error: null,
    })

    const purgeChain = makeChain({ data: null, error: null })

    // insert returns unique-violation error (replay)
    const insertChain = makeChain({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    })

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(usersChain as any)
      .mockReturnValueOnce(purgeChain as any)
      .mockReturnValueOnce(insertChain as any)

    const { verifyUserTotpCode } = await import('../totp')
    const result = await verifyUserTotpCode(userId, validCode)

    expect(result).toEqual({ valid: false })
  })

  it('TEST 3 — transient DB error (non-23505): fails open, returns { valid: true }', async () => {
    const validCode = generateCurrentCode(base32Secret)

    const usersChain = makeChain({
      data: {
        totp_secret: encryptedSecret,
        totp_enabled: true,
        totp_backup_codes: [],
      },
      error: null,
    })

    const purgeChain = makeChain({ data: null, error: null })

    // insert returns a transient infrastructure error (not 23505)
    const insertChain = makeChain({
      data: null,
      error: { code: '57014', message: 'query cancelled due to timeout' },
    })

    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(usersChain as any)
      .mockReturnValueOnce(purgeChain as any)
      .mockReturnValueOnce(insertChain as any)

    const { verifyUserTotpCode } = await import('../totp')
    const result = await verifyUserTotpCode(userId, validCode)

    // Non-23505 error → fail open (don't lock out legitimate users)
    expect(result).toEqual({ valid: true })
  })
})
