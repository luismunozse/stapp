import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  isPremium: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/lib/whatsapp/encryption", () => ({
  decrypt: vi.fn().mockReturnValue("decrypted-token"),
}))

vi.mock("@/lib/whatsapp/client", () => ({
  sendTextMessage: vi.fn().mockResolvedValue({ success: true, messageId: "msg-123" }),
}))

import { isPremium } from "@/lib/subscriptions"
import { sendTextMessage } from "@/lib/whatsapp/client"
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

  it("returns 403 when not premium", async () => {
    mockAuthSuccess()
    vi.mocked(isPremium).mockResolvedValueOnce(false)

    const response = await POST(createPostRequest({ phoneNumber: "123", message: "hola" }))
    const { status, body } = await parseResponse(response)
    expect(status).toBe(403)
    expect(body.code).toBe("PREMIUM_REQUIRED")
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

    const response = await POST(createPostRequest({
      phoneNumber: "123",
      message: "x".repeat(4097),
    }))
    const { status } = await parseResponse(response)
    expect(status).toBe(400)
  })

  it("returns 400 when WhatsApp not configured", async () => {
    mockAuthSuccess()
    const configChain = createChainMock(null, { code: "PGRST116" })
    mockSupabaseFrom({ whatsapp_config: configChain })

    const response = await POST(createPostRequest({ phoneNumber: "123", message: "hola" }))
    const { status, body } = await parseResponse(response)
    expect(status).toBe(400)
    expect(body.error).toBe("WhatsApp Business no configurado")
  })

  it("sends custom message via API successfully", async () => {
    mockAuthSuccess()
    const configChain = createChainMock({
      phone_number_id: "phone-1",
      access_token_encrypted: "encrypted",
      is_configured: true,
    })
    mockSupabaseFrom({ whatsapp_config: configChain })

    const response = await POST(createPostRequest({
      phoneNumber: "+5491155554444",
      message: "Tu orden CEL001 está lista para retirar",
    }))
    const { status, body } = await parseResponse(response)
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.messageId).toBe("msg-123")

    // Verify the ACTUAL message was sent, not a hardcoded test message
    expect(sendTextMessage).toHaveBeenCalledWith(
      "phone-1",
      "decrypted-token",
      "+5491155554444",
      "Tu orden CEL001 está lista para retirar"
    )
  })

  it("returns error when sendTextMessage fails", async () => {
    mockAuthSuccess()
    vi.mocked(sendTextMessage).mockResolvedValueOnce({ success: false, error: "Invalid phone" })

    const configChain = createChainMock({
      phone_number_id: "phone-1",
      access_token_encrypted: "encrypted",
      is_configured: true,
    })
    mockSupabaseFrom({ whatsapp_config: configChain })

    const response = await POST(createPostRequest({
      phoneNumber: "invalid",
      message: "test",
    }))
    const { status, body } = await parseResponse(response)
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toBe("Invalid phone")
  })
})
