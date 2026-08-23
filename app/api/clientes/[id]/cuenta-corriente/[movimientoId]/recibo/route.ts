import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateReciboCCPDF } from "@/lib/cuenta-corriente-react-pdf"
import { isMissingColumnError } from "@/lib/db-errors"

// Emisor columns in two tiers: migration 295's fiscal identity columns may
// not be applied yet, and a recibo must still print without them. Same
// pattern as app/api/facturacion/[id]/pdf/route.ts — see lib/db-errors.ts for
// why the SELECT side raises 42703 rather than PGRST204.
const ORG_COLS = "nombre, nombre_mostrar, telefono, direccion, logo_url, moneda, zona_horaria"
const ORG_COLS_FISCAL = `${ORG_COLS}, cuit, condicion_iva, domicilio_fiscal`

/**
 * PostgREST reports an unknown RPC as PGRST202 ("Could not find the function
 * ... in the schema cache"). Migrations here are applied by hand, so the code
 * can ship before 306 does — say so plainly instead of surfacing a bare 500.
 */
function isMissingFunctionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const e = error as Record<string, unknown>
  const code = String(e.code ?? "")
  const msg = String(e.message ?? "").toLowerCase()
  return code === "PGRST202" || code === "42883" || msg.includes("could not find the function")
}

// GET - Recibo PDF de un movimiento de cuenta corriente
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; movimientoId: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: clienteId, movimientoId } = await params

    // select("*") on purpose: numero_recibo only exists after migration 306,
    // and the RPC below is what reads it anyway.
    const { data: movimiento, error: movError } = await supabaseAdmin
      .from("cuenta_corriente")
      .select("*")
      .eq("id", movimientoId)
      .eq("cliente_id", clienteId)
      .eq("organization_id", organizationId!)
      .single()

    if (movError || !movimiento) {
      return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 })
    }

    if (!["DEPOSITO", "PAGO"].includes(movimiento.tipo)) {
      return NextResponse.json(
        { error: "Solo se emite recibo de depósitos y pagos a cuenta corriente" },
        { status: 400 }
      )
    }

    const { data: cliente } = await supabaseAdmin
      .from("clientes")
      .select("nombre, telefono, email, direccion, dni")
      .eq("id", clienteId)
      .eq("organization_id", organizationId!)
      .single()

    let { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select(ORG_COLS_FISCAL)
      .eq("id", organizationId!)
      .single()

    if (orgError && isMissingColumnError(orgError)) {
      ;({ data: org } = await supabaseAdmin
        .from("organizations")
        .select(ORG_COLS)
        .eq("id", organizationId!)
        .single() as { data: typeof org })
    }

    // Sucursal and operator are decoration: a missing row must not block the
    // receipt, so both are best-effort lookups rather than joins.
    const [sucursal, usuario] = await Promise.all([
      movimiento.sucursal_id
        ? supabaseAdmin.from("sucursales").select("nombre").eq("id", movimiento.sucursal_id).single()
        : Promise.resolve({ data: null }),
      movimiento.usuario_id
        ? supabaseAdmin.from("users").select("nombre").eq("id", movimiento.usuario_id).single()
        : Promise.resolve({ data: null }),
    ])

    // Mints the number on first emission and returns the same one on every
    // reprint (migration 306).
    const { data: numero, error: numeroError } = await supabaseAdmin.rpc("asignar_numero_recibo_cc", {
      p_org_id: organizationId!,
      p_movimiento_id: movimientoId,
    })

    if (numeroError) {
      if (isMissingFunctionError(numeroError)) {
        console.error("asignar_numero_recibo_cc missing — migration 306 not applied", numeroError)
        return NextResponse.json(
          { error: "La numeración de recibos no está disponible. Falta aplicar la migración 306." },
          { status: 503 }
        )
      }
      throw numeroError
    }

    const orgAny = org as Record<string, unknown> | null
    const pdfBuffer = await generateReciboCCPDF({
      numeroRecibo: `REC-${String(numero).padStart(5, "0")}`,
      fecha: movimiento.created_at,
      tipo: movimiento.tipo,
      monto: parseFloat(movimiento.monto),
      saldoPosterior: parseFloat(movimiento.saldo_posterior),
      metodoPago: movimiento.metodo_pago,
      numeroReferencia: movimiento.numero_referencia,
      observaciones: movimiento.observaciones,
      cliente: {
        nombre: cliente?.nombre,
        dni: cliente?.dni,
        telefono: cliente?.telefono,
        email: cliente?.email,
        direccion: cliente?.direccion,
      },
      nombreEmpresa: (orgAny?.nombre_mostrar as string) || (orgAny?.nombre as string),
      telefonoEmpresa: orgAny?.telefono as string,
      direccionEmpresa: orgAny?.direccion as string,
      cuitEmpresa: orgAny?.cuit as string,
      condicionIvaEmpresa: orgAny?.condicion_iva as string,
      domicilioFiscalEmpresa: orgAny?.domicilio_fiscal as string,
      logoUrl: orgAny?.logo_url as string,
      moneda: orgAny?.moneda as string,
      zonaHoraria: orgAny?.zona_horaria as string,
      sucursalNombre: sucursal?.data?.nombre ?? null,
      atendidoPor: usuario?.data?.nombre ?? null,
    })

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="recibo-${String(numero).padStart(5, "0")}.pdf"`,
        // Private only: the number is stable, but the balance printed on it
        // is a point-in-time value.
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (error) {
    console.error("Error generating recibo de cuenta corriente:", error)
    return NextResponse.json({ error: "Error al generar el recibo" }, { status: 500 })
  }
}
