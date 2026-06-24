import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createHmac } from "crypto"
import { mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { POST } from "@/app/api/whatsapp/webhook/route"

// ─── Helpers ────────────────────────────────────────────────────────────────

const TEST_SECRET = "test-app-secret-abc123"
const WEBHOOK_URL = "http://localhost:3000/api/whatsapp/webhook"

/** Build a raw JSON string body exactly as Meta would send it */
function buildRawBody(payload: object): string {
  return JSON.stringify(payload)
}

/** Compute the correct HMAC signature for a given raw body */
function sign(rawBody: string, secret: string = TEST_SECRET): string {
  const hmac = createHmac("sha256", secret)
  hmac.update(rawBody)
  return "sha256=" + hmac.digest("hex")
}

/** Build a Request with correct Content-Type, optional sig header, and a raw string body */
function buildRequest(rawBody: string, signatureHeader?: string): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (signatureHeader !== undefined) {
    headers["x-hub-signature-256"] = signatureHeader
  }
  return new Request(WEBHOOK_URL, {
    method: "POST",
    headers,
    body: rawBody,
  })
}

/** A minimal well-formed status-update payload */
const STATUS_PAYLOAD = {
  entry: [
    {
      changes: [
        {
          value: {
            statuses: [{ id: "wamid-1", status: "delivered", errors: [] }],
          },
        },
      ],
    },
  ],
}

/** A minimal well-formed incoming message payload — affirmative "si" */
function incomingMessagePayload(text: string) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "phone-id-1" },
              messages: [
                {
                  type: "text",
                  from: "5491100000000",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/whatsapp/webhook — HMAC signature verification (Fix 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("WHATSAPP_APP_SECRET", TEST_SECRET)

    // Default: all table calls return harmless empty data
    mockSupabaseFrom({
      whatsapp_messages: createChainMock(null),
      whatsapp_config: createChainMock(null),
      clientes: createChainMock([]),
      ordenes_servicio: createChainMock(null),
      orden_eventos: createChainMock(null),
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns 401 and does NOT call supabase when X-Hub-Signature-256 header is missing", async () => {
    const rawBody = buildRawBody(STATUS_PAYLOAD)
    const req = buildRequest(rawBody, undefined) // no header

    const res = await POST(req)

    expect(res.status).toBe(401)
    expect(vi.mocked(supabaseAdmin.from)).not.toHaveBeenCalled()
  })

  it("returns 401 and does NOT call supabase when signature is invalid", async () => {
    const rawBody = buildRawBody(STATUS_PAYLOAD)
    const req = buildRequest(rawBody, "sha256=deadbeefdeadbeef")

    const res = await POST(req)

    expect(res.status).toBe(401)
    expect(vi.mocked(supabaseAdmin.from)).not.toHaveBeenCalled()
  })

  it("processes the request and returns 200 when signature is valid", async () => {
    const rawBody = buildRawBody(STATUS_PAYLOAD)
    const validSig = sign(rawBody)
    const req = buildRequest(rawBody, validSig)

    const res = await POST(req)

    expect(res.status).toBe(200)
    // Processing should have happened (supabase called for status update)
    expect(vi.mocked(supabaseAdmin.from)).toHaveBeenCalled()
  })

  it("returns 503 and does NOT call supabase when WHATSAPP_APP_SECRET is not set", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "")

    const rawBody = buildRawBody(STATUS_PAYLOAD)
    const req = buildRequest(rawBody, sign(rawBody))

    const res = await POST(req)

    expect(res.status).toBe(503)
    expect(vi.mocked(supabaseAdmin.from)).not.toHaveBeenCalled()
  })
})

describe("POST /api/whatsapp/webhook — affirmative word-boundary matching (Fix 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("WHATSAPP_APP_SECRET", TEST_SECRET)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  /**
   * Sets up supabase mocks so that if affirmative path is taken,
   * we can detect the ordenes_servicio update call.
   * Returns the ordenes chain so we can assert on `.update`.
   */
  function setupAffirmativeMocks() {
    const ordenesChain = createChainMock({ id: "order-1", numero_orden: "001" })
    mockSupabaseFrom({
      whatsapp_config: createChainMock({ organization_id: "org-1" }),
      clientes: createChainMock([{ id: "client-1" }]),
      ordenes_servicio: ordenesChain,
      orden_eventos: createChainMock(null),
    })
    return ordenesChain
  }

  async function postText(text: string): Promise<Response> {
    const rawBody = buildRawBody(incomingMessagePayload(text))
    const sig = sign(rawBody)
    return POST(buildRequest(rawBody, sig))
  }

  it('"asi no" does NOT auto-approve — false positive guard', async () => {
    const ordenesChain = setupAffirmativeMocks()

    const res = await postText("asi no")

    expect(res.status).toBe(200)
    // update() must NOT have been called on ordenes_servicio for this path
    expect(ordenesChain.update).not.toHaveBeenCalled()
  })

  it('"sigo" does NOT auto-approve', async () => {
    const ordenesChain = setupAffirmativeMocks()

    await postText("sigo adelante pero no confirmo")

    expect(ordenesChain.update).not.toHaveBeenCalled()
  })

  it('"casi" does NOT auto-approve', async () => {
    const ordenesChain = setupAffirmativeMocks()

    await postText("casi lo confirmo")

    expect(ordenesChain.update).not.toHaveBeenCalled()
  })

  it('"si" alone DOES auto-approve', async () => {
    const ordenesChain = setupAffirmativeMocks()

    await postText("si")

    expect(ordenesChain.update).toHaveBeenCalled()
  })

  it('"dale" DOES auto-approve', async () => {
    const ordenesChain = setupAffirmativeMocks()

    await postText("dale")

    expect(ordenesChain.update).toHaveBeenCalled()
  })

  it('"ok aprobado" DOES auto-approve', async () => {
    const ordenesChain = setupAffirmativeMocks()

    await postText("ok aprobado")

    expect(ordenesChain.update).toHaveBeenCalled()
  })

  it('"Si, gracias" (capitalized) DOES auto-approve', async () => {
    const ordenesChain = setupAffirmativeMocks()

    await postText("Si, gracias")

    expect(ordenesChain.update).toHaveBeenCalled()
  })
})
