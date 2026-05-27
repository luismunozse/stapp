import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
  isPremium: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/lib/whatsapp/providers", () => ({
  sendWhatsAppText: vi.fn().mockResolvedValue({ success: true, messageId: "msg-123", provider: "meta" }),
}))

import { hasPlanFeature } from "@/lib/subscriptions"
import { sendWhatsAppText } from "@/lib/whatsapp/providers"
import { POST } from "@/app/api/whatsapp/send/route"

describe("POST /api/whatsapp/send", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const response = await POST(createPostRequest({ phoneNumber: "123", message: "hola" }))
    const { status } = await parseResponse(response)
    expect(status).toBe(401)
  })

  it("returns 403 when plan feature missing", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValueOnce(false)

    const response = await POST(createPostRequest({ phoneNumber: "123", message: "hola" }))
    const { status, body } = await parseResponse(response)
    expect(status).toBe(403)
    expect(body.code).toBe("FEATURE_REQUIRED")
  })

  it("validates phoneNumber is required", async () => {
    mockAuthSuccess()
    const response = await POST(createPostRequest({ message: "hola" }))
    const { status } = await parseResponse(response)
    expect(status).toBe(400)
  })

  it("validates message is required", async () => {
    mockAuthSuccess()
    const response = await POST(createPostRequest({ phoneNumber: "123" }))
    const { status } = await parseResponse(response)
    expect(status).toBe(400)
  })

  it("validates message max length", async () => {
    mockAuthSuccess()
    const response = await POST(createPostRequest({ phoneNumber: "123", message: "x".repeat(4097) }))
    const { status } = await parseResponse(response)
    expect(status).toBe(400)
  })

  it("sends custom message via dispatcher", async () => {
    mockAuthSuccess()
    const response = await POST(createPostRequest({
      phoneNumber: "+5491155554444",
      message: "Tu orden CEL001 está lista para retirar",
    }))
    const { status, body } = await parseResponse(response)
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.messageId).toBe("msg-123")
    expect(sendWhatsAppText).toHaveBeenCalledWith(
      expect.any(String),
      "+5491155554444",
      "Tu orden CEL001 está lista para retirar"
    )
  })

  it("returns error when send fails", async () => {
    mockAuthSuccess()
    vi.mocked(sendWhatsAppText).mockResolvedValueOnce({ success: false, error: "Invalid phone", provider: "meta" })

    const response = await POST(createPostRequest({ phoneNumber: "invalid", message: "test" }))
    const { status, body } = await parseResponse(response)
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toBe("Invalid phone")
  })
})
