import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getIvaGeneral } from "@/lib/countries"
import { resolveTerminologia } from "@/lib/terminologia"
import { hasPlanFeature } from "@/lib/subscriptions"

/**
 * GET /api/configuracion/operativa — lo que cualquier usuario de la org necesita
 * para operar: moneda, zona horaria, país, régimen fiscal y garantía por defecto.
 *
 * GET /api/configuracion es solo ADMIN y el POS y el CurrencyProvider la usaban
 * para todos. Un VENDEDOR recibía 403 y el POS seguía como si la org fuera
 * EXENTA: con IVA aditivo cobraba $1.000 mientras el server esperaba $1.210 y
 * rechazaba la venta (o, con "paga después", cargaba la diferencia a la cuenta
 * del cliente sin que nadie la viera). Además veía ARS y hora de Buenos Aires
 * en orgs de otros países. Acá va solo configuración no sensible.
 */
export async function GET() {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    // select("*"): columnas agregadas por migraciones distintas (229 fiscal,
    // 310 tasa por país); si alguna no corrió queda undefined en vez de tirar
    // la consulta entera.
    const { data: org, error: dbError } = await supabaseAdmin
      .from("organizations")
      .select("*")
      .eq("id", organizationId!)
      .single()

    if (dbError || !org) {
      return NextResponse.json({ error: "Organización no encontrada" }, { status: 404 })
    }

    // La emisión de factura electrónica es solo ADMIN (requireAdmin en
    // /api/facturacion-electronica/emitir): al resto no se le ofrece.
    const facturacionElectronicaDisponible =
      role === "ADMIN" &&
      org.pais === "AR" &&
      (await hasPlanFeature(organizationId!, "facturacion_electronica"))

    return NextResponse.json({
      nombreEmpresa: org.nombre_mostrar || org.nombre || "",
      moneda: org.moneda || "ARS",
      zonaHoraria: org.zona_horaria || "America/Argentina/Buenos_Aires",
      pais: org.pais || "AR",
      terminologia: resolveTerminologia(org.terminologia ?? null),
      ivaRegimen: org.iva_regimen ?? "EXENTO",
      // NULL = sin tasa propia, usar la del país (migración 310).
      ivaTasa: org.iva_tasa ?? getIvaGeneral(org.pais),
      redondeoEfectivo: org.redondeo_efectivo ?? 0,
      garantiaDiasDefault: org.garantia_dias_default ?? 30,
      facturacionElectronicaDisponible,
    })
  } catch (error) {
    console.error("Error fetching configuracion operativa:", error)
    return NextResponse.json({ error: "Error al obtener la configuración" }, { status: 500 })
  }
}
