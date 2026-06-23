// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createHmac } from "crypto"
import { verifyWebhookSignature } from "@/lib/mercadopago"

// El webhook de MP firma `id:<dataId>;request-id:<reqId>;ts:<ts>;` con HMAC-SHA256.
// verifyWebhookSignature normaliza el secret (trim + quita comillas envolventes)
// antes de calcular el HMAC, para tolerar env loaders que dejan `"abc"` literal.

const DATA_ID = "123ABC"
const REQ_ID = "req-1"
const TS = "1700000000"

/** Construye el header x-signature válido para un secret YA limpio. */
function buildSignature(cleanSecret: string): string {
  const manifest = `id:${DATA_ID.toLowerCase()};request-id:${REQ_ID};ts:${TS};`
  const v1 = createHmac("sha256", cleanSecret).update(manifest).digest("hex")
  return `ts=${TS},v1=${v1}`
}

describe("verifyWebhookSignature — normalización del secret", () => {
  const CLEAN = "mp-super-secret"
  let original: string | undefined

  beforeEach(() => {
    original = process.env.MERCADOPAGO_WEBHOOK_SECRET
  })
  afterEach(() => {
    if (original === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET
    else process.env.MERCADOPAGO_WEBHOOK_SECRET = original
  })

  it("valida cuando el secret está limpio (baseline)", () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = CLEAN
    const res = verifyWebhookSignature(buildSignature(CLEAN), REQ_ID, DATA_ID)
    expect(res.valid).toBe(true)
    expect(res.reason).toBe("ok")
  })

  it("valida aunque el secret venga con comillas dobles envolventes", () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = `"${CLEAN}"`
    const res = verifyWebhookSignature(buildSignature(CLEAN), REQ_ID, DATA_ID)
    expect(res.valid).toBe(true)
  })

  it("valida aunque el secret venga con comillas simples y whitespace", () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = `  '${CLEAN}'  `
    const res = verifyWebhookSignature(buildSignature(CLEAN), REQ_ID, DATA_ID)
    expect(res.valid).toBe(true)
  })

  it("rechaza si la firma no corresponde al secret limpio", () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = `"${CLEAN}"`
    const res = verifyWebhookSignature(buildSignature("otro-secret"), REQ_ID, DATA_ID)
    expect(res.valid).toBe(false)
  })
})
