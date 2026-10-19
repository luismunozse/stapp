import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { isMissingColumnError } from "@/lib/db-errors"
import { SAFE_COLUMNS, SNAPSHOT_COLUMNS } from "@/lib/facturacion/comprobante-columns"
import {
  generateComprobanteFiscalPDF,
  ComprobanteIncompletoError,
  type ComprobanteFiscalRow,
} from "@/lib/comprobante-fiscal-react-pdf"

// react-pdf necesita el runtime de Node (no Edge).
export const runtime = "nodejs"

const DATOS_INCOMPLETOS = "El comprobante tiene datos incompletos: no se puede generar el PDF con QR."

// Mismo SELECT en dos escalones: con la foto fiscal y, si la migracion aun no
// esta aplicada (42703), solo con las columnas de siempre.
function buscarComprobante(id: string, organizationId: string, conFoto: boolean) {
  return supabaseAdmin
    .from("comprobantes_fiscales")
    .select(conFoto ? `${SAFE_COLUMNS}, ${SNAPSHOT_COLUMNS}` : SAFE_COLUMNS)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .eq("estado", "emitido")
    .maybeSingle()
}

// GET - PDF fiscal de un comprobante emitido. No depende del plan ni del
// toggle: un documento fiscal tiene que seguir legible despues de un downgrade.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    // Se filtra por id Y organizacion: los numeros de comprobante se repiten
    // entre orgs y supabaseAdmin no pasa por RLS.
    let conFoto = true
    let { data: fila, error: dbError } = await buscarComprobante(id, organizationId!, true)
    if (dbError && isMissingColumnError(dbError)) {
      conFoto = false
      ;({ data: fila, error: dbError } = await buscarComprobante(id, organizationId!, false))
    }
    if (dbError) {
      console.error("Error loading comprobante for PDF:", dbError)
      return NextResponse.json({ error: "No se pudo cargar el comprobante" }, { status: 500 })
    }
    if (!fila) {
      return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 })
    }
    // Sin la migracion no hay foto fiscal: no se puede armar un QR valido.
    if (!conFoto) {
      return NextResponse.json({ error: DATOS_INCOMPLETOS }, { status: 409 })
    }

    // select("*") a proposito: las columnas fiscales de la org llegaron en
    // migraciones distintas y un SELECT explicito tumbaria la cascada.
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("*")
      .eq("id", organizationId!)
      .single()
    const o = (org ?? {}) as Record<string, any>

    const comprobante = fila as unknown as ComprobanteFiscalRow
    let pdf: Buffer
    try {
      pdf = await generateComprobanteFiscalPDF({
        comprobante,
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
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="factura-${letra}-${numero}.pdf"`,
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (error) {
    console.error("Error generating comprobante fiscal PDF:", error)
    return NextResponse.json({ error: "Error al generar el PDF del comprobante" }, { status: 500 })
  }
}
