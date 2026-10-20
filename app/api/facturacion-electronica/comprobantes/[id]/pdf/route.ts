import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { isMissingColumnError } from "@/lib/db-errors"
import { SAFE_COLUMNS, SNAPSHOT_COLUMNS } from "@/lib/facturacion/comprobante-columns"
import { esNotaCreditoFiscal } from "@/lib/facturacion/cbte-tipo"
import { fechaDeRespuestaEmision, type ComprobanteAsociado } from "@/lib/facturacion/comprobante-asociado"
import {
  generateComprobanteFiscalPDF,
  ComprobanteIncompletoError,
  type ComprobanteFiscalRow,
} from "@/lib/comprobante-fiscal-react-pdf"

// react-pdf necesita el runtime de Node (no Edge).
export const runtime = "nodejs"

const FORMA_ID = /^[A-Za-z0-9_-]{1,64}$/

const DATOS_INCOMPLETOS = "El comprobante tiene datos incompletos: no se puede generar el PDF con QR."
const NO_EMITIDO = "El comprobante todavía no está emitido: no hay PDF para imprimir."
const SIN_FACTURA_ASOCIADA =
  "No se encontró la factura que anula esta nota de crédito: no se puede generar el PDF."

// Una factura anulada sigue siendo un documento fiscal emitido: se reimprime igual.
const ESTADOS_IMPRIMIBLES = ["emitido", "anulado"]

// Cada migracion que agrega columnas es un escalon: si el SELECT falla con 42703
// se baja al siguiente. Con la asociacion de la nota de credito (371) > con la
// foto fiscal (QR) > solo lo de siempre (sin foto no hay QR valido: 409).
const SELECTS = [
  `${SAFE_COLUMNS}, ${SNAPSHOT_COLUMNS}, comprobante_asociado_id`,
  `${SAFE_COLUMNS}, ${SNAPSHOT_COLUMNS}`,
  SAFE_COLUMNS,
] as const
const ESCALON_SIN_FOTO = SELECTS.length - 1

function buscarComprobante(id: string, organizationId: string, escalon: number) {
  return supabaseAdmin
    .from("comprobantes_fiscales")
    .select(SELECTS[escalon])
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle()
}

// La factura que anula una nota de credito. provider_response se lee solo para
// fechar una factura legada (sin fecha_emision) y nunca sale del servidor: al PDF
// llegan unicamente tipo, numero y fecha.
function buscarFacturaAsociada(asociadaId: string, organizationId: string) {
  return supabaseAdmin
    .from("comprobantes_fiscales")
    .select("tipo, numero, fecha_emision, provider_response")
    .eq("id", asociadaId)
    .eq("organization_id", organizationId)
    .maybeSingle()
}

// GET - PDF fiscal de un comprobante emitido (factura o nota de credito) o de
// una factura anulada. No depende del plan ni del toggle: un documento fiscal
// tiene que seguir legible despues de un downgrade.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    // Los ids son TEXT (cuid). Una forma imposible no tiene nada que buscar:
    // 404 sin tocar la DB.
    if (!FORMA_ID.test(id)) {
      return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 })
    }

    // Se filtra por id Y organizacion: los numeros de comprobante se repiten
    // entre orgs y supabaseAdmin no pasa por RLS.
    let escalon = 0
    let { data: fila, error: dbError } = await buscarComprobante(id, organizationId!, escalon)
    while (dbError && isMissingColumnError(dbError) && escalon < ESCALON_SIN_FOTO) {
      escalon++
      ;({ data: fila, error: dbError } = await buscarComprobante(id, organizationId!, escalon))
    }
    if (dbError?.code === "22P02") {
      return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 })
    }
    if (dbError) {
      console.error("Error loading comprobante for PDF:", dbError)
      return NextResponse.json({ error: "No se pudo cargar el comprobante" }, { status: 500 })
    }
    if (!fila) {
      return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 })
    }

    const comprobante = fila as unknown as ComprobanteFiscalRow & {
      estado?: string | null
      comprobante_asociado_id?: string | null
    }
    // pendiente / rechazado: la fila existe pero no hay documento fiscal que imprimir.
    if (!ESTADOS_IMPRIMIBLES.includes(String(comprobante.estado))) {
      return NextResponse.json({ error: NO_EMITIDO }, { status: 409 })
    }
    // Sin la migracion no hay foto fiscal: no se puede armar un QR valido.
    if (escalon === ESCALON_SIN_FOTO) {
      return NextResponse.json({ error: DATOS_INCOMPLETOS }, { status: 409 })
    }

    // Una nota de credito imprime la factura que anula: se lee con OTRA consulta
    // tambien acotada por organizacion (el id sale de la fila ya validada).
    let asociado: ComprobanteAsociado | null = null
    if (esNotaCreditoFiscal(comprobante.cbte_tipo)) {
      if (!comprobante.comprobante_asociado_id) {
        return NextResponse.json({ error: SIN_FACTURA_ASOCIADA }, { status: 409 })
      }
      const { data: factura, error: asociadaError } = await buscarFacturaAsociada(
        comprobante.comprobante_asociado_id,
        organizationId!
      )
      if (asociadaError) {
        console.error("Error loading the invoice annulled by a credit note for PDF:", asociadaError)
        return NextResponse.json({ error: "No se pudo cargar el comprobante" }, { status: 500 })
      }
      const f = factura as unknown as {
        tipo?: string | null
        numero?: string | null
        fecha_emision?: string | null
        provider_response?: unknown
      } | null
      if (!f?.numero) {
        return NextResponse.json({ error: SIN_FACTURA_ASOCIADA }, { status: 409 })
      }
      asociado = {
        tipo: f.tipo === "C" ? "C" : "B",
        numero: f.numero,
        // Una factura legada no guardo su fecha, pero si la respuesta de ARCA.
        fecha: f.fecha_emision ?? fechaDeRespuestaEmision(f.provider_response),
      }
    }

    // select("*") a proposito: las columnas fiscales de la org llegaron en
    // migraciones distintas y un SELECT explicito tumbaria la cascada.
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("*")
      .eq("id", organizationId!)
      .single()
    const o = (org ?? {}) as Record<string, any>

    let pdf: Buffer
    try {
      pdf = await generateComprobanteFiscalPDF({
        comprobante,
        asociado,
        emisor: {
          nombreEmpresa: o.nombre_mostrar || o.nombre,
          telefonoEmpresa: o.telefono,
          direccionEmpresa: o.direccion,
          domicilioFiscalEmpresa: o.domicilio_fiscal,
          cuitEmpresa: o.cuit,
          pais: o.pais,
          condicionIvaEmpresa: o.condicion_iva,
          ingresosBrutosEmpresa: o.ingresos_brutos,
          inicioActividadesEmpresa: o.inicio_actividades,
          logoUrl: o.logo_url,
        },
      })
    } catch (e) {
      if (e instanceof ComprobanteIncompletoError) {
        return NextResponse.json({ error: DATOS_INCOMPLETOS }, { status: 409 })
      }
      throw e
    }

    // El numero es 'PPPP-NNNNNNNN' (formato propio); se sanea igual porque va
    // dentro de una cabecera HTTP.
    const letra = comprobante.tipo === "C" ? "C" : "B"
    const numero = String(comprobante.numero ?? id).replace(/[^A-Za-z0-9-]/g, "")
    const prefijo = asociado ? "nota-credito" : "factura"
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${prefijo}-${letra}-${numero}.pdf"`,
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (error) {
    console.error("Error generating comprobante fiscal PDF:", error)
    return NextResponse.json({ error: "Error al generar el PDF del comprobante" }, { status: 500 })
  }
}
