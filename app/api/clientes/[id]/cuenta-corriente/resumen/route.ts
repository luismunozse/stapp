import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateResumenCCPDF } from "@/lib/cuenta-corriente-react-pdf"
import { isMissingColumnError } from "@/lib/db-errors"
import { dayRangeUtc, todayInTimeZone, DEFAULT_TIMEZONE } from "@/lib/timezone"

// Same two-tier emisor select as the recibo route: migration 295's fiscal
// columns may not be applied yet and the statement must still print.
const ORG_COLS = "nombre, nombre_mostrar, telefono, direccion, logo_url, moneda, zona_horaria"
const ORG_COLS_FISCAL = `${ORG_COLS}, cuit, condicion_iva, domicilio_fiscal`

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

// A statement is a document someone reads, not a data dump. Past this many
// rows the PDF stops being useful long before it stops being generatable, so
// refuse with a clear instruction instead of rendering hundreds of pages.
const MAX_MOVIMIENTOS = 1000

// GET - Resumen de cuenta corriente en PDF para un rango de fechas
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: clienteId } = await params

    const { data: cliente } = await supabaseAdmin
      .from("clientes")
      .select("nombre, telefono, email, direccion, dni")
      .eq("id", clienteId)
      .eq("organization_id", organizationId!)
      .single()

    if (!cliente) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })
    }

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

    const orgAny = org as Record<string, unknown> | null
    const tz = (orgAny?.zona_horaria as string) || DEFAULT_TIMEZONE

    // Defaults to the current month-to-date in the org's own timezone, so a
    // caller can omit the range entirely.
    const { searchParams } = new URL(request.url)
    const hoy = todayInTimeZone(tz)
    const desde = searchParams.get("desde") || `${hoy.slice(0, 7)}-01`
    const hasta = searchParams.get("hasta") || hoy

    if (!DATE_ONLY.test(desde) || !DATE_ONLY.test(hasta)) {
      return NextResponse.json({ error: "Fechas inválidas: usar formato YYYY-MM-DD" }, { status: 400 })
    }
    if (desde > hasta) {
      return NextResponse.json({ error: "La fecha desde no puede ser posterior a la fecha hasta" }, { status: 400 })
    }

    // The org's calendar day, not the server's — dayRangeUtc handles the
    // offset so 21:00-24:00 local movements don't land in the next day.
    const inicioUtc = dayRangeUtc(desde, tz).desde
    const finUtc = dayRangeUtc(hasta, tz).hasta

    // Opening balance = the balance the last movement BEFORE the range left
    // behind. No movement before it means the account starts at zero.
    const { data: previo } = await supabaseAdmin
      .from("cuenta_corriente")
      .select("saldo_posterior")
      .eq("organization_id", organizationId!)
      .eq("cliente_id", clienteId)
      .lt("created_at", inicioUtc)
      // id breaks created_at ties deterministically: cuids are time-ordered,
      // so the tiebreak agrees with insertion order. Without it two movements
      // stamped in the same transaction could pick either one as "the last",
      // and the opening/closing balances would flip between renders.
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    const saldoInicial = previo ? parseFloat(previo.saldo_posterior) : 0

    const { data: rows, error: movError } = await supabaseAdmin
      .from("cuenta_corriente")
      .select("tipo, monto, saldo_posterior, metodo_pago, numero_referencia, referencia_tipo, created_at")
      .eq("organization_id", organizationId!)
      .eq("cliente_id", clienteId)
      .gte("created_at", inicioUtc)
      .lte("created_at", finUtc)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(MAX_MOVIMIENTOS + 1)

    if (movError) throw movError

    const movimientosRaw = rows || []
    if (movimientosRaw.length > MAX_MOVIMIENTOS) {
      return NextResponse.json(
        { error: `El período supera los ${MAX_MOVIMIENTOS} movimientos. Elegí un rango más corto.` },
        { status: 400 }
      )
    }

    const movimientos = movimientosRaw.map((m) => ({
      fecha: m.created_at,
      tipo: m.tipo,
      monto: parseFloat(m.monto),
      saldoPosterior: parseFloat(m.saldo_posterior),
      metodoPago: m.metodo_pago,
      numeroReferencia: m.numero_referencia,
      referenciaTipo: m.referencia_tipo,
    }))

    // Closing balance is the last in-range movement's running balance — NOT
    // clientes.saldo_cuenta, which is today's balance and would be wrong for
    // any range that doesn't end today.
    const saldoFinal = movimientos.length ? movimientos[movimientos.length - 1].saldoPosterior : saldoInicial

    const pdfBuffer = await generateResumenCCPDF({
      desde,
      hasta,
      saldoInicial,
      saldoFinal,
      movimientos,
      cliente: {
        nombre: cliente.nombre,
        dni: cliente.dni,
        telefono: cliente.telefono,
        email: cliente.email,
        direccion: cliente.direccion,
      },
      nombreEmpresa: (orgAny?.nombre_mostrar as string) || (orgAny?.nombre as string),
      telefonoEmpresa: orgAny?.telefono as string,
      direccionEmpresa: orgAny?.direccion as string,
      cuitEmpresa: orgAny?.cuit as string,
      condicionIvaEmpresa: orgAny?.condicion_iva as string,
      domicilioFiscalEmpresa: orgAny?.domicilio_fiscal as string,
      logoUrl: orgAny?.logo_url as string,
      moneda: orgAny?.moneda as string,
      zonaHoraria: tz,
    })

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="resumen-cuenta-${desde}_${hasta}.pdf"`,
        // No caching: an open-ended range keeps changing as movements land.
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    console.error("Error generating resumen de cuenta corriente:", error)
    return NextResponse.json({ error: "Error al generar el resumen de cuenta" }, { status: 500 })
  }
}
