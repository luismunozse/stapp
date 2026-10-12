/**
 * /.well-known/assetlinks.json — Digital Asset Links para App Links de Android.
 *
 * El AndroidManifest declara autoVerify="true", así que Android lee este archivo
 * al instalar la app. Una huella mal formada rompe la verificación en silencio
 * (los links vuelven a abrir en el navegador), así que se filtran acá.
 */
import { describe, it, expect, afterEach } from "vitest"
import { parseResponse } from "./helpers"
import { GET } from "@/app/api/public/assetlinks/route"

const FP_A = "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99"
const FP_B = "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00"

const original = process.env.ANDROID_CERT_SHA256

afterEach(() => {
  if (original === undefined) delete process.env.ANDROID_CERT_SHA256
  else process.env.ANDROID_CERT_SHA256 = original
})

describe("GET /.well-known/assetlinks.json", () => {
  it("devuelve lista vacía y sin cachear cuando no hay huella configurada", async () => {
    delete process.env.ANDROID_CERT_SHA256

    const res = await GET()
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body).toEqual([])
    // Sin no-store, Android podría cachear el archivo vacío y no reintentar
    // la verificación cuando se setea la env var.
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("declara el package y la huella cuando está configurada", async () => {
    process.env.ANDROID_CERT_SHA256 = FP_A

    const { body } = await parseResponse(await GET())

    expect(body).toHaveLength(1)
    expect(body[0].relation).toEqual(["delegate_permission/common.handle_all_urls"])
    expect(body[0].target).toEqual({
      namespace: "android_app",
      package_name: "ar.com.stapp.app",
      sha256_cert_fingerprints: [FP_A],
    })
  })

  it("acepta varias huellas separadas por coma, normalizando espacios y minúsculas", async () => {
    process.env.ANDROID_CERT_SHA256 = ` ${FP_A.toLowerCase()} , ${FP_B} `

    const { body } = await parseResponse(await GET())

    expect(body[0].target.sha256_cert_fingerprints).toEqual([FP_A, FP_B])
  })

  it("descarta huellas con formato inválido en vez de publicarlas", async () => {
    process.env.ANDROID_CERT_SHA256 = `no-es-una-huella,${FP_A},AA:BB:CC`

    const { body } = await parseResponse(await GET())

    expect(body[0].target.sha256_cert_fingerprints).toEqual([FP_A])
  })

  it("no publica el bloque si ninguna huella es válida", async () => {
    process.env.ANDROID_CERT_SHA256 = "deadbeef"

    const { body } = await parseResponse(await GET())

    expect(body).toEqual([])
  })
})
