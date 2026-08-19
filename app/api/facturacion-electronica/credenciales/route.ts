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

export async function PUT(request: Request) {
  const { error, organizationId } = await requireAdmin()
  if (error) return error

  const body = await request.json().catch(() => null)
  const { certPem, keyPem, cuit, condicionFiscal } = body || {}

  if (!certPem || !keyPem || !cuit) {
    return NextResponse.json({ error: "Faltan certPem, keyPem o cuit" }, { status: 400 })
  }

  const cuitNormalizado = String(cuit).replace(/\D/g, "")
  if (!CUIT_FORMAT.test(cuitNormalizado)) {
    return NextResponse.json({ error: "CUIT inválido (deben ser 11 dígitos)" }, { status: 400 })
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
    organization_id: organizationId!,
    provider: "arca",
    cert_pem_enc: certPemEnc,
    key_pem_enc: keyPemEnc,
    cuit: validated.cuit,
    cert_subject: validated.subject,
    cert_fingerprint: validated.fingerprint,
    cert_not_before: validated.notBefore,
    cert_not_after: validated.notAfter,
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
    condicionFiscal: cond,
  })
}
