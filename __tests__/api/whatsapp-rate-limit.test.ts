import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createPostRequest,
  parseResponse,
} from "./helpers"

// ─── Module mocks (hoisted) ───────────────────────────────────────────────────

vi.mock("@/lib/rate-limit", () => ({
  persistentRateLimit: vi.fn().mockResolvedValue({ success: true, limit: 100, remaining: 99, reset: 0 }),
}))

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/lib/whatsapp/providers", () => ({
  sendWhatsAppText: vi.fn().mockResolvedValue({ success: true, messageId: "msg-999", provider: "meta" }),
}))

// requireAdmin delegates to auth() which is globally mocked in vitest.setup.ts
// mockAuthSuccess() configures auth() to return an ADMIN session — that covers
// both requireAuth() and requireAdmin().

import { persistentRateLimit } from "@/lib/rate-limit"
import { sendWhatsAppText } from "@/lib/whatsapp/providers"
import { POST as sendPOST } from "@/app/api/whatsapp/send/route"
import { POST as testPOST } from "@/app/api/whatsapp/test/route"

// ─── /api/whatsapp/send ───────────────────────────────────────────────────────

describe("POST /api/whatsapp/send — rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(persistentRateLimit).mockResolvedValue({ success: true, limit: 100, remaining: 99, reset: 0 })
  })

  it("returns 429 when persistentRateLimit returns success:false", async () => {
    mockAuthSuccess()
    vi.mocked(persistentRateLimit).mockResolvedValueOnce({ success: false, limit: 100, remaining: 0, reset: Date.now() + 3600 })

    const res = await sendPOST(createPostRequest({ phoneNumber: "+5491155554444", message: "hola" }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(429)
    expect(body.error).toBeDefined()
  })

  it("calls persistentRateLimit with the org id and whatsapp:send endpoint", async () => {
    mockAuthSuccess({ organizationId: "org-42" })

    await sendPOST(createPostRequest({ phoneNumber: "+5491155554444", message: "hola" }))

    expect(persistentRateLimit).toHaveBeenCalledWith("org-42", "whatsapp:send", expect.any(Number), expect.any(Number))
  })

  it("proceeds and calls sendWhatsAppText when rate limit allows", async () => {
    mockAuthSuccess()

    const res = await sendPOST(createPostRequest({ phoneNumber: "+5491155554444", message: "hola" }))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(sendWhatsAppText).toHaveBeenCalled()
  })
})

// ─── /api/whatsapp/send — phone format validation ────────────────────────────

describe("POST /api/whatsapp/send — phone validation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(persistentRateLimit).mockResolvedValue({ success: true, limit: 100, remaining: 99, reset: 0 })
  })

  it("returns 400 for alphabetic phone number", async () => {
    mockAuthSuccess()
    const res = await sendPOST(createPostRequest({ phoneNumber: "abc", message: "hola" }))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("returns 400 for phone number with injection characters", async () => {
    mockAuthSuccess()
    const res = await sendPOST(createPostRequest({ phoneNumber: "=cmd|' /C calc'!A0", message: "hola" }))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("returns 400 for phone number that is too short (< 8 digits)", async () => {
    mockAuthSuccess()
    const res = await sendPOST(createPostRequest({ phoneNumber: "1234567", message: "hola" }))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("returns 400 for phone number that is too long (> 15 digits)", async () => {
    mockAuthSuccess()
    const res = await sendPOST(createPostRequest({ phoneNumber: "1234567890123456", message: "hola" }))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("accepts valid E.164 phone number with leading +", async () => {
    mockAuthSuccess()
    const res = await sendPOST(createPostRequest({ phoneNumber: "+5491155554444", message: "hola" }))
    const { status } = await parseResponse(res)
    expect(status).toBe(200)
  })

  it("accepts valid phone number without leading +", async () => {
    mockAuthSuccess()
    const res = await sendPOST(createPostRequest({ phoneNumber: "5491155554444", message: "hola" }))
    const { status } = await parseResponse(res)
    expect(status).toBe(200)
  })
})

// ─── /api/whatsapp/test — rate limiting ──────────────────────────────────────

describe("POST /api/whatsapp/test — rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(persistentRateLimit).mockResolvedValue({ success: true, limit: 20, remaining: 19, reset: 0 })
  })

  it("returns 429 when rate limit is exceeded", async () => {
    mockAuthSuccess()
    vi.mocked(persistentRateLimit).mockResolvedValueOnce({ success: false, limit: 20, remaining: 0, reset: Date.now() + 3600 })

    const res = await testPOST(createPostRequest({ phoneNumber: "+5491155554444" }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(429)
    expect(body.error).toBeDefined()
  })

  it("calls persistentRateLimit with whatsapp:test endpoint", async () => {
    mockAuthSuccess({ organizationId: "org-7" })

    await testPOST(createPostRequest({ phoneNumber: "+5491155554444" }))

    expect(persistentRateLimit).toHaveBeenCalledWith("org-7", "whatsapp:test", expect.any(Number), expect.any(Number))
  })
})

// ─── /api/whatsapp/test — phone format validation ────────────────────────────

describe("POST /api/whatsapp/test — phone validation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(persistentRateLimit).mockResolvedValue({ success: true, limit: 20, remaining: 19, reset: 0 })
  })

  it("returns 400 for alphabetic phone number", async () => {
    mockAuthSuccess()
    const res = await testPOST(createPostRequest({ phoneNumber: "abc" }))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("returns 400 for phone number with injection characters", async () => {
    mockAuthSuccess()
    const res = await testPOST(createPostRequest({ phoneNumber: "=cmd|' /C calc'!A0" }))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("returns 400 when phoneNumber is missing", async () => {
    mockAuthSuccess()
    const res = await testPOST(createPostRequest({}))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("accepts a valid E.164 phone number", async () => {
    mockAuthSuccess()
    const res = await testPOST(createPostRequest({ phoneNumber: "+5491155554444" }))
    const { status } = await parseResponse(res)
    expect(status).toBe(200)
  })
})
