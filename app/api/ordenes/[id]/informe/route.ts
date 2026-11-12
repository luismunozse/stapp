import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { actorDeSesion, cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { cargarAvancesVisibles } from "@/lib/ordenes/avances-server"
import { cargarFotosInforme, ETIQUETA_TIPO_FOTO } from "@/lib/ordenes/informe-fotos"
import { construirTrabajos } from "@/lib/ordenes/trabajos-orden"
import { generateInformeTecnicoPDF, type InformeTecnicoPDFData } from "@/lib/informe-tecnico-react-pdf"
import { getDeviceTypeLabel } from "@/lib/device-types"
import { getEstadoOrdenUi } from "@/lib/estado-orden-ui"
import { getTerminologia } from "@/lib/terminologia-server"
import { t } from "@/lib/terminologia"

const TOKENS_TELEFONO = new Set(["celular", "telefono", "smartphone", "movil"])
const esTelefono = (tipo: string) =>
  tipo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((tok) => TOKENS_TELEFONO.has(tok))

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

/**
 * Informe técnico de la orden (PDF de varias páginas para el cliente):
 * diagnóstico completo, avances visibles, trabajo realizado y fotos.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const autenticado = await requireAuth()
    const { error, organizationId } = autenticado
    if (error) return error

    const { id } = await params
    const cargada = await cargarOrdenEnAlcance(id, actorDeSesion(autenticado), "leer", {
      select: `
        *,
        tipos_dispositivo:tipo_dispositivo_id(nombre),
        clientes (*),
        organizations (*),
        tecnico:tecnico_id ( nombre ),
        sucursales:sucursal_id ( nombre ),
        repuestos_orden (
          nombre, cantidad, precio_venta_unitario,
          inventario:inventario_id ( nombre )
        ),
        servicios_orden ( nombre, cantidad, precio_unitario ),
        garantias ( dias_validez, fecha_vencimiento, estado )
      `,
    })
    if ("error" in cargada) return cargada.error
    const { orden } = cargada

    const [avances, fotos, terminologia] = await Promise.all([
      cargarAvancesVisibles(orden.id, organizationId!),
      cargarFotosInforme(orden.id),
      getTerminologia(organizationId!),
    ])

    const org = orden.organizations ?? {}
    const cliente = orden.clientes ?? {}
    const tipoDisp = getDeviceTypeLabel(texto(orden.tipo_dispositivo) || "OTRO", orden.tipos_dispositivo?.nombre)
    const garantiasArr: any[] = Array.isArray(orden.garantias) ? orden.garantias : orden.garantias ? [orden.garantias] : []
    const garantia = garantiasArr
      .filter((g) => g && g.estado !== "ANULADA")
      .sort((a, b) => new Date(b.fecha_vencimiento).getTime() - new Date(a.fecha_vencimiento).getTime())[0]

    const data: InformeTecnicoPDFData = {
      nombreEmpresa: texto(org.nombre_mostrar) || texto(org.nombre),
      telefonoEmpresa: texto(org.telefono),
      direccionEmpresa: texto(org.direccion),
      pais: texto(org.pais),
      logoUrl: texto(org.logo_url),
      moneda: texto(org.moneda) || "ARS",
      zonaHoraria: texto(org.zona_horaria),
      sucursalNombre: texto(orden.sucursales?.nombre),
      cliente: {
        nombre: texto(cliente.nombre),
        telefono: texto(orden.telefono_contacto) || texto(cliente.telefono),
        email: texto(cliente.email),
      },
      codigoOrden: texto(orden.codigo_orden) || `#${orden.numero_orden}`,
      fechaIngreso: orden.fecha_ingreso,
      fechaEntrega: orden.fecha_entrega ?? null,
      estado: getEstadoOrdenUi(orden.estado).labelCliente || orden.estado,
      equipo: {
        tipo: tipoDisp,
        marca: texto(orden.marca),
        modelo: texto(orden.dispositivo),
        color: texto(orden.color),
        identificadorLabel: esTelefono(tipoDisp) ? "IMEI" : t(terminologia, "serie"),
        identificador: texto(orden.imei),
      },
      falla: texto(orden.problema_reportado) || "",
      diagnostico: texto(orden.diagnostico),
      tecnicoNombre: texto(orden.tecnico?.nombre),
      avances: avances ?? [],
      trabajos:
        construirTrabajos({
          repuestos: (orden.repuestos_orden || []) as any[],
          servicios: (orden.servicios_orden || []) as any[],
        }) ?? [],
      costoFinal: typeof orden.costo_final === "number" ? orden.costo_final : null,
      garantia: garantia ? { dias: garantia.dias_validez, fechaVencimiento: garantia.fecha_vencimiento } : null,
      fotos: fotos.map((f) => ({ etiqueta: ETIQUETA_TIPO_FOTO[f.tipo], descripcion: f.descripcion, fecha: f.fecha, jpeg: f.jpeg })),
    }

    const pdf = await generateInformeTecnicoPDF(data)
    const nombre = `informe-${(texto(orden.codigo_orden) || String(orden.numero_orden)).replace(/[^A-Za-z0-9_-]/g, "")}.pdf`
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${nombre}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("Error generating informe técnico:", error)
    return NextResponse.json({ error: "Error al generar el informe técnico" }, { status: 500 })
  }
}
