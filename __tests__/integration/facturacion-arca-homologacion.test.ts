// @vitest-environment node
/**
 * Chequeo REAL contra el ambiente de homologación de ARCA.
 *
 * No corre en CI ni en un `vitest run` normal: se saltea solo salvo que
 * estén las tres variables. Para correrlo:
 *
 *   ARCA_HOMO_CERT_PATH=C:/Users/.../stapp-homo.crt \
 *   ARCA_HOMO_KEY_PATH=C:/Users/.../stapp-homo.key \
 *   ARCA_HOMO_CUIT=23944498389 \
 *   npx vitest run __tests__/integration/facturacion-arca-homologacion.test.ts
 *
 * OJO: emite un comprobante de verdad en homologación cada vez que corre, y
 * consume el numerador del punto de venta. Es el ambiente de pruebas de
 * ARCA, así que no tiene efecto fiscal.
 *
 * Ejercita el camino de producción salvo el store de Supabase: `wsaaLogin`
 * (login real) -> `toLoginCredentials` (inyección con handleTicket) ->
 * `buildVoucher` (armado) -> FECAESolicitar. Lo único que reemplaza es
 * `renewWsaaTicket`, que necesita base de datos.
 *
 * El ticket se cachea en disco a propósito. AFIP entrega UN TA por
 * certificado y servicio, válido 12 h, y rechaza cualquier login nuevo
 * mientras ese siga vivo (`coe.alreadyAuthenticated`). Sin cache, la segunda
 * corrida del día falla — y eso es exactamente lo que le pasaría a cada cold
 * start en producción si el ticket no viviera en `wsaa_tickets`.
 */
import { describe, it, expect } from "vitest"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { Arca } from "@arcasdk/core"
import { buildVoucher } from "@/lib/facturacion/arca/voucher"
import { toLoginCredentials, wsaaLogin } from "@/lib/facturacion/arca/wsaa-login"
import type { ArcaCredenciales, EmitirInput } from "@/lib/facturacion/types"

const CERT_PATH = process.env.ARCA_HOMO_CERT_PATH
const KEY_PATH = process.env.ARCA_HOMO_KEY_PATH
const CUIT = process.env.ARCA_HOMO_CUIT

const configurado = !!CERT_PATH && !!KEY_PATH && !!CUIT

/** Mismo margen que `readWsaaTicket`: dentro de los 10 min se trata como miss. */
const MARGEN_MS = 10 * 60 * 1000

function rutaTicket(): string {
  return process.env.ARCA_HOMO_TICKET_PATH ?? join(tmpdir(), `arca-homo-ta-${CUIT}-wsfe.json`)
}

/**
 * Espejo en disco de lo que `renewWsaaTicket` hace contra Supabase. Sin esto
 * el test solo se puede correr una vez cada 12 h.
 */
async function obtenerTicketCacheado(creds: ArcaCredenciales) {
  const ruta = rutaTicket()

  if (existsSync(ruta)) {
    const guardado = JSON.parse(readFileSync(ruta, "utf8")) as {
      token: string
      sign: string
      expiresAt: string
    }
    if (new Date(guardado.expiresAt).getTime() - Date.now() > MARGEN_MS) return guardado
  }

  const nuevo = await wsaaLogin({
    cuit: creds.cuit,
    certPem: creds.certPem,
    keyPem: creds.keyPem,
    production: false,
    service: "wsfe",
  })
  writeFileSync(ruta, JSON.stringify(nuevo), "utf8")
  return nuevo
}

describe.skipIf(!configurado)("facturación ARCA — homologación real", () => {
  it("obtiene un CAE emitiendo una Factura C", async () => {
    const creds: ArcaCredenciales = {
      organizationId: "homologacion",
      cuit: CUIT!,
      certPem: readFileSync(CERT_PATH!, "utf8"),
      keyPem: readFileSync(KEY_PATH!, "utf8"),
      puntoVenta: 1,
      condicionFiscal: "MONOTRIBUTO",
      production: false,
    }

    const input: EmitirInput = {
      ventaId: "homologacion",
      moneda: "PES",
      total: 1000,
      receptor: {
        razonSocial: "Consumidor Final",
        documentoTipo: "CONSUMIDOR FINAL",
        documentoNro: "0",
        condicionIva: "CF",
      },
      items: [{ cantidad: 1, descripcion: "Cambio de pantalla", importeUnitario: 1000, alicuotaIva: 21 }],
    }

    const ticket = await obtenerTicketCacheado(creds)

    expect(ticket.token).toBeTruthy()
    expect(ticket.sign).toBeTruthy()

    const arca = new Arca({
      production: false,
      cuit: Number(creds.cuit),
      cert: creds.certPem,
      key: creds.keyPem,
      handleTicket: true,
      credentials: toLoginCredentials(ticket),
    })

    const fecha = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(new Date())
      .replaceAll("-", "")

    const voucher = buildVoucher(creds, input, { cbteFch: fecha })
    const resultado = await arca.electronicBillingService.createNextVoucher(voucher)

    const detalle = resultado.response?.FeDetResp?.FECAEDetResponse?.[0]

    expect(detalle?.Resultado).toBe("A")
    expect(resultado.cae).toMatch(/^\d{14}$/)
    expect(resultado.caeFchVto).toMatch(/^\d{8}$/)
  }, 120_000)
})
