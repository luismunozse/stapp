import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { encryptSecret } from "@/lib/facturacion/crypto"
import { isMissingColumnError } from "@/lib/db-errors"
import { validateCertKeyPair, CertValidationError } from "@/lib/facturacion/arca/cert"

/**
 * Credenciales fiscales — proveedor ARCA directo (migración 299, design
 * ADR-01/ADR-04/ADR-14). GET expone solo metadata derivada del certificado
 * (nunca el PEM cifrado ni en texto plano). PUT es write-only: valida el
 * par cert/clave contra el CUIT declarado, cifra y persiste; la respuesta
 * nunca ecoa el material recibido, incluso en el 200 de éxito.
 */

const ARCA_SELECT =
  "organization_id, provider, cuit, cert_subject, cert_not_before, cert_not_after, cert_fingerprint, estado, punto_venta, condicion_fiscal, updated_at"

interface CredRow {
  organization_id: string
  provider?: string | null
  cuit?: string | null
  cert_subject?: string | null
  cert_not_before?: string | null
  cert_not_after?: string | null
  cert_fingerprint?: string | null
  estado?: string | null
  punto_venta?: number | null
  condicion_fiscal?: string | null
  updated_at?: string | null
}

/**
 * `estado` se deriva en lectura, no se confía ciegamente en la columna: un
 * certificado ARCA vencido bloquea la emisión aunque la fila quedó
 * 'conectado' la última vez que se guardó (design, resolved open question #4).
 */
function computeEstado(row: CredRow | null): string {
  if (!row) return "sin_configurar"
  if (row.provider === "arca" && row.cert_not_after && new Date(row.cert_not_after).getTime() <= Date.now()) {
    return "cert_vencido"
  }
  return row.estado ?? "conectado"
}

export async function GET() {
  const { error, organizationId } = await requireAdmin()
  if (error) return error

  const result = await supabaseAdmin
    .from("facturacion_credenciales")
    .select(ARCA_SELECT)
    .eq("organization_id", organizationId!)
    .maybeSingle()

  if (isMissingColumnError(result.error)) {
    // Migración 299 no aplicada: sin las columnas de certificado esta
    // feature queda "sin_configurar" a ojos del cliente aunque exista una
    // fila legacy de TusFacturas — tier A (design ADR-13).
    return NextResponse.json({
      conectado: false,
      provider: null,
      estado: "sin_configurar",
      cuit: null,
      certSubject: null,
      certNotBefore: null,
      certNotAfter: null,
      certFingerprint: null,
      puntoVenta: null,
      condicionFiscal: null,
      updatedAt: null,
      migracionPendiente: true,
    })
  }

  const data = (result.data as CredRow | null) ?? null

  return NextResponse.json({
    conectado: !!data,
    provider: data?.provider ?? null,
    estado: computeEstado(data),
    cuit: data?.cuit ?? null,
    certSubject: data?.cert_subject ?? null,
    certNotBefore: data?.cert_not_before ?? null,
    certNotAfter: data?.cert_not_after ?? null,
    certFingerprint: data?.cert_fingerprint ?? null,
    puntoVenta: data?.punto_venta ?? null,
    condicionFiscal: data?.condicion_fiscal ?? null,
    updatedAt: data?.updated_at ?? null,
  })
}

const CUIT_FORMAT = /^\d{11}$/

// Generoso para cualquier PEM real (un cert/key X.509 típico pesa unos
// pocos KB) — solo evita hacer trabajo de crypto sobre un payload absurdo
// (P3s, review PR2, engram #1125).
const MAX_PEM_LENGTH = 64 * 1024

/**
 * PUT acepta DOS formas durante la transición (review PR2, engram #1125,
 * P1b): la tabla de credenciales tiene una fila real y alcanzable de
 * TusFacturas en producción (facturacion_electronica está viva para el plan
 * Profesional desde la migración 296) — el shape viejo
 * {apitoken,apikey,usertoken} sigue funcionando exactamente igual que antes
 * de este cambio, al lado del shape nuevo {certPem,keyPem,cuit}. Un payload
 * que mezcla campos de ambos shapes es ambiguo y se rechaza sin tocar la DB.
 */
export async function PUT(request: Request) {
  const { error, organizationId } = await requireAdmin()
  if (error) return error

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 })
  }

  const hasArcaShape = "certPem" in body || "keyPem" in body
  const hasLegacyShape = "apitoken" in body || "apikey" in body || "usertoken" in body

  if (hasArcaShape && hasLegacyShape) {
    return NextResponse.json(
      { error: "Payload ambiguo: no se puede combinar certPem/keyPem con apitoken/apikey/usertoken" },
      { status: 400 }
    )
  }

  if (hasLegacyShape) {
    return putTusFacturas(organizationId!, body)
  }

  return putArca(organizationId!, body)
}

async function putArca(organizationId: string, body: any) {
  const { certPem, keyPem, cuit, condicionFiscal, puntoVenta } = body

  if (!certPem || !keyPem || !cuit) {
    return NextResponse.json({ error: "Faltan certPem, keyPem o cuit" }, { status: 400 })
  }

  if (String(certPem).length > MAX_PEM_LENGTH || String(keyPem).length > MAX_PEM_LENGTH) {
    return NextResponse.json({ error: "certPem o keyPem excede el tamaño máximo permitido (64KB)" }, { status: 400 })
  }

  const cuitNormalizado = String(cuit).replace(/\D/g, "")
  if (!CUIT_FORMAT.test(cuitNormalizado)) {
    return NextResponse.json({ error: "CUIT inválido (deben ser 11 dígitos)" }, { status: 400 })
  }

  // El punto de venta lo da de alta el contribuyente en ARCA y no tiene por
  // qué ser el 1; emitir contra uno que no existe rebota. ARCA los numera con
  // 5 dígitos, así que 99999 es el techo real.
  let puntoVentaValidado = 1
  if (puntoVenta !== undefined) {
    const n = Number(puntoVenta)
    if (!Number.isInteger(n) || n <= 0 || n > 99999) {
      return NextResponse.json({ error: "Punto de venta inválido" }, { status: 400 })
    }
    puntoVentaValidado = n
  }

  let validated
  try {
    validated = validateCertKeyPair({ certPem, keyPem, declaredCuit: cuitNormalizado })
  } catch (e) {
    if (e instanceof CertValidationError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 })
    }
    return NextResponse.json({ error: "No se pudo validar el certificado" }, { status: 400 })
  }

  const cond = condicionFiscal === "RESPONSABLE_INSCRIPTO" ? "RESPONSABLE_INSCRIPTO" : "MONOTRIBUTO"

  let certPemEnc: string
  let keyPemEnc: string
  try {
    certPemEnc = encryptSecret(certPem)
    keyPemEnc = encryptSecret(keyPem)
  } catch {
    // FACTURACION_ENCRYPTION_KEY sin configurar (lib/facturacion/crypto.ts
    // falla cerrado): nunca guardar cert/key en claro, nunca un 500 crudo
    // (design ADR-09).
    return NextResponse.json({ error: "Cifrado no configurado" }, { status: 500 })
  }

  const { error: dbError } = await supabaseAdmin.from("facturacion_credenciales").upsert({
    organization_id: organizationId,
    provider: "arca",
    cert_pem_enc: certPemEnc,
    key_pem_enc: keyPemEnc,
    cuit: validated.cuit,
    cert_subject: validated.subject,
    cert_fingerprint: validated.fingerprint,
    cert_not_before: validated.notBefore,
    cert_not_after: validated.notAfter,
    punto_venta: puntoVentaValidado,
    condicion_fiscal: cond,
    estado: "conectado",
    updated_at: new Date().toISOString(),
  })

  if (dbError) {
    if (isMissingColumnError(dbError)) {
      // Migración 299 no aplicada: no hay dónde guardar cert/key todavía —
      // tier A (design ADR-13), 503 en vez de un 500 genérico.
      return NextResponse.json({ error: "Migración pendiente: contactar soporte" }, { status: 503 })
    }
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 })
  }

  return NextResponse.json({
    conectado: true,
    provider: "arca",
    estado: "conectado",
    cuit: validated.cuit,
    certSubject: validated.subject,
    certNotBefore: validated.notBefore,
    certNotAfter: validated.notAfter,
    certFingerprint: validated.fingerprint,
    puntoVenta: puntoVentaValidado,
    condicionFiscal: cond,
  })
}

/**
 * Shape legacy de TusFacturas, preservada byte a byte (validación y
 * contrato de respuesta) respecto de la versión anterior a este cambio —
 * components/configuracion/configuracion-form.tsx (sin modificar, vivo en
 * producción) depende de este contrato exacto.
 */
async function putTusFacturas(organizationId: string, body: any) {
  const { apitoken, apikey, usertoken, puntoVenta, condicionFiscal } = body

  if (!apitoken || !apikey || !usertoken) {
    return NextResponse.json({ error: "Faltan credenciales" }, { status: 400 })
  }

  let puntoVentaValidado = 1
  if (puntoVenta !== undefined) {
    const n = Number(puntoVenta)
    if (!Number.isInteger(n) || n <= 0) {
      return NextResponse.json({ error: "Punto de venta inválido" }, { status: 400 })
    }
    puntoVentaValidado = n
  }

  const cond = condicionFiscal === "RESPONSABLE_INSCRIPTO" ? "RESPONSABLE_INSCRIPTO" : "MONOTRIBUTO"

  let apitokenEnc: string
  let apikeyEnc: string
  let usertokenEnc: string
  try {
    apitokenEnc = encryptSecret(String(apitoken))
    apikeyEnc = encryptSecret(String(apikey))
    usertokenEnc = encryptSecret(String(usertoken))
  } catch {
    return NextResponse.json({ error: "Cifrado no configurado" }, { status: 500 })
  }

  const payload = {
    organization_id: organizationId,
    provider: "tusfacturas",
    apitoken_enc: apitokenEnc,
    apikey_enc: apikeyEnc,
    usertoken_enc: usertokenEnc,
    punto_venta: puntoVentaValidado,
    condicion_fiscal: cond,
    estado: "conectado",
    updated_at: new Date().toISOString(),
  }

  let { error: dbError } = await supabaseAdmin.from("facturacion_credenciales").upsert(payload)

  if (isMissingColumnError(dbError)) {
    // Migración 299 no aplicada todavía: `provider` no existe como columna
    // en este esquema. Reintentar sin ella preserva el comportamiento
    // exacto previo a este cambio — tier A (design ADR-13). Toda fila en
    // ese esquema es implícitamente 'tusfacturas', así que no hace falta
    // taggearla explícitamente.
    const { provider: _provider, ...legacyPayload } = payload
    ;({ error: dbError } = await supabaseAdmin.from("facturacion_credenciales").upsert(legacyPayload))
  }

  if (dbError) {
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 })
  }

  return NextResponse.json({
    conectado: true,
    puntoVenta: puntoVentaValidado,
    condicionFiscal: cond,
  })
}
