import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateOrdenPDF, OrdenPDFData } from "@/lib/pdf"
import { getDeviceTypeLabel } from "@/lib/device-types"
import { headers } from "next/headers"
import { getTerminologia } from "@/lib/terminologia-server"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { id } = await params

    // Obtener la orden con datos del cliente y organización
    const { data: orden, error: dbError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        *,
        tipos_dispositivo:tipo_dispositivo_id(nombre, config),
        clientes (*),
        organizations (*),
        users:entregado_por_user_id (
          nombre
        ),
        tecnico:tecnico_id (
          nombre
        ),
        recibidoPor:recibido_por (
          nombre
        ),
        sectores_cliente (
          nombre
        ),
        sucursales:sucursal_id (
          nombre, direccion, telefono
        ),
        repuestos_orden (
          nombre, cantidad, precio_venta_unitario,
          inventario:inventario_id ( nombre )
        ),
        garantias (
          dias_validez, fecha_vencimiento, notas
        )
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (dbError || !orden) {
      return NextResponse.json(
        { error: "Orden no encontrada" },
        { status: 404 }
      )
    }

    // Técnicos solo pueden ver PDF de sus órdenes asignadas
    if (role === "TECNICO" && orden.tecnico_id !== userId) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 403 }
      )
    }

    // Fetch checklist data
    const { data: checklistData } = await supabaseAdmin
      .from("checklist_recepcion")
      .select(`
        valores, notas, firma_cliente, firma_mime,
        checklist_templates (
          checklist_template_items (id, label, orden, categoria)
        )
      `)
      .eq("orden_id", id)
      .maybeSingle()

    // Firma del lote solo cuando la orden vino de una recepcion multiple.
    // Con recepcion_id en NULL (flujo clasico) no se hace ninguna query extra.
    let firmaRecepcionLote: string | null = null
    if (orden.recepcion_id) {
      const { data: recepcion } = await supabaseAdmin
        .from("recepciones")
        .select("firma_cliente")
        .eq("id", orden.recepcion_id)
        .maybeSingle()
      firmaRecepcionLote = recepcion?.firma_cliente ?? null
    }

    // Fetch intake photos
    const { data: fotosData } = await supabaseAdmin
      .from("fotos_orden")
      .select("url, descripcion")
      .eq("orden_id", id)
      .eq("tipo", "INGRESO")
      .order("created_at", { ascending: true })
      .limit(4)

    // Cobros no anulados (expediente: banda de cobros)
    const { data: cobrosData } = await supabaseAdmin
      .from("cobros_orden")
      .select("monto, metodo_pago, numero_referencia, created_at")
      .eq("orden_id", id)
      .eq("anulado", false)
      .order("created_at", { ascending: true })

    // Timeline de estados (expediente): primera ocurrencia de cada estado.
    const { data: tiemposData } = await supabaseAdmin
      .from("orden_tiempos_estado")
      .select("estado, inicio")
      .eq("orden_id", id)
      .order("inicio", { ascending: true })

    // Reingreso: resolver el numero de la orden origen (una sola query,
    // solo cuando corresponde).
    let ordenOrigenNumero: number | null = null
    if (orden.es_reingreso && orden.orden_origen_id) {
      const { data: ordenOrigen } = await supabaseAdmin
        .from("ordenes_servicio")
        .select("numero_orden")
        .eq("id", orden.orden_origen_id)
        .maybeSingle()
      ordenOrigenNumero = ordenOrigen?.numero_orden ?? null
    }

    // Build base URL for QR
    const headersList = await headers()
    const host = headersList.get("host") || "localhost:3000"
    const proto = headersList.get("x-forwarded-proto") || "https"
    const baseUrl = `${proto}://${host}`

    const cliente = orden.clientes as any
    const org = orden.organizations as any
    const entregadoPorUser = orden.users as any
    const sectorObj = orden.sectores_cliente as any
    const tipoDisp = orden.tipos_dispositivo as any
    const sucursalObj = orden.sucursales as any
    const tecnicoObj = orden.tecnico as any
    const recibidoPorObj = orden.recibidoPor as any
    const garantiaObj = orden.garantias as any

    // Helper to ensure we only pass primitive values
    const safeString = (val: unknown): string | null => {
      if (val === null || val === undefined) return null
      if (typeof val === "string") return val
      if (typeof val === "number") return String(val)
      if (typeof val === "boolean") return val ? "Si" : "No"
      // For objects, try to stringify or return null
      if (typeof val === "object") {
        try {
          return JSON.stringify(val)
        } catch {
          return null
        }
      }
      return String(val)
    }

    // Build checklist items with labels
    let checklistItems: Array<{ label: string; valor: boolean | string | null; categoria?: string | null }> | null = null
    if (checklistData?.checklist_templates) {
      const templateItems = (checklistData.checklist_templates as any).checklist_template_items || []
      const valores = typeof checklistData.valores === "string"
        ? JSON.parse(checklistData.valores)
        : checklistData.valores || {}
      const sortedItems = [...templateItems].sort((a: any, b: any) => (a.orden || 0) - (b.orden || 0))
      checklistItems = sortedItems.map((item: any) => ({
        label: item.label,
        valor: valores[item.id] ?? null,
        categoria: item.categoria ?? null,
      })).filter((item: any) => item.valor !== null && item.valor !== undefined)
    }

    // Metadata JSONB -> camposExtra del tipo de dispositivo. Si una key de
    // metadata no tiene entrada en config.camposExtra (config vieja o campo
    // borrado), cae al key crudo como label en vez de perder el dato.
    const camposExtraConfig: Array<{ key: string; label: string }> = tipoDisp?.config?.camposExtra || []
    const metadataObj = orden.metadata && typeof orden.metadata === "object" ? orden.metadata : {}
    const metadataEntries = Object.entries(metadataObj)
    const metadataCampos = metadataEntries.length > 0
      ? metadataEntries.map(([key, val]) => {
          const campo = camposExtraConfig.find((c) => c.key === key)
          return { label: campo?.label || key, valor: safeString(val) || "" }
        })
      : null

    // Trabajos (repuestos_orden): precio de VENTA unicamente, nunca costo
    // (precio_unitario / costo). El nombre resuelve manual -> join a inventario.
    const repuestosArr = (orden.repuestos_orden || []) as any[]
    const trabajos = repuestosArr.length > 0
      ? repuestosArr.map((r) => {
          const cantidad = Number(r.cantidad) || 0
          const precioVenta = Number(r.precio_venta_unitario) || 0
          return {
            nombre: safeString(r.nombre) || safeString(r.inventario?.nombre) || "",
            cantidad,
            importe: cantidad * precioVenta,
          }
        })
      : null

    const garantia = garantiaObj ? {
      dias: garantiaObj.dias_validez,
      fechaVencimiento: new Date(garantiaObj.fecha_vencimiento),
      notas: safeString(garantiaObj.notas),
    } : null

    const cobros = cobrosData && cobrosData.length > 0
      ? cobrosData.map((c: any) => ({
          fecha: new Date(c.created_at),
          metodo: c.metodo_pago,
          referencia: safeString(c.numero_referencia),
          monto: Number(c.monto) || 0,
        }))
      : null

    // Timeline: primera ocurrencia de cada estado (orden_tiempos_estado ya
    // viene ordenado por inicio ascendente).
    const timelineSeen = new Set<string>()
    const timelineAll = ((tiemposData || []) as any[])
      .filter((t) => {
        if (timelineSeen.has(t.estado)) return false
        timelineSeen.add(t.estado)
        return true
      })
      .map((t) => ({ estado: t.estado, fecha: new Date(t.inicio) }))
    const timeline = timelineAll.length > 0 ? timelineAll : null

    // Preparar datos para el PDF - ensuring all values are primitives
    const pdfData: OrdenPDFData = {
      numeroOrden: orden.numero_orden,
      fechaIngreso: new Date(orden.fecha_ingreso),
      fechaPrometida: orden.fecha_prometida ? new Date(orden.fecha_prometida) : null,
      cliente: {
        nombre: safeString(cliente?.nombre) || "Sin nombre",
        telefono: safeString(cliente?.telefono) || "Sin teléfono",
        email: safeString(cliente?.email),
        direccion: safeString(cliente?.direccion),
        dni: safeString(cliente?.dni),
        cuit: safeString(cliente?.cuit),
        razonSocial: safeString(cliente?.razon_social),
        tipoCliente: safeString(cliente?.tipo_cliente),
      },
      dispositivo: safeString(orden.dispositivo) || "Sin especificar",
      tipoDispositivo: getDeviceTypeLabel(safeString(orden.tipo_dispositivo) || "OTRO", tipoDisp?.nombre),
      marca: safeString(orden.marca),
      color: safeString(orden.color),
      imei: safeString(orden.imei),
      problemaReportado: safeString(orden.problema_reportado) || "Sin descripción",
      accesorios: safeString(orden.accesorios),
      codigoAccesoDispositivo: safeString(orden.password_dispositivo),
      presupuesto: typeof orden.presupuesto === "number" ? orden.presupuesto : null,
      observaciones: safeString(orden.observaciones),
      nombreEmpresa: safeString(org?.nombre_mostrar) || safeString(org?.nombre) || undefined,
      telefonoEmpresa: safeString(org?.telefono) || undefined,
      direccionEmpresa: safeString(org?.direccion) || undefined,
      ciudadEmpresa: safeString(org?.ciudad) || undefined,
      provinciaEmpresa: safeString(org?.provincia) || undefined,
      codigoPostalEmpresa: safeString(org?.codigo_postal) || undefined,
      logoUrl: safeString(org?.logo_url),
      moneda: safeString(org?.moneda) || "ARS",
      zonaHoraria: safeString(org?.zona_horaria) || "America/Argentina/Buenos_Aires",
      estado: safeString(orden.estado) || undefined,
      fechaEntrega: orden.fecha_entrega ? new Date(orden.fecha_entrega) : null,
      firmaClienteEntrega: safeString(orden.firma_cliente_entrega),
      firmaClienteEntregaMime: safeString(orden.firma_cliente_entrega_mime),
      firmaEncargadoEntrega: safeString(orden.firma_encargado_entrega),
      firmaEncargadoEntregaMime: safeString(orden.firma_encargado_entrega_mime),
      entregadoPor: safeString(entregadoPorUser?.nombre),
      notasEntrega: safeString(orden.notas_entrega),
      sector: safeString(sectorObj?.nombre),
      recepcionTerminos: safeString(org?.recepcion_terminos) || undefined,
      publicToken: safeString(orden.public_token),
      baseUrl,
      sena: typeof orden.sena === "number" && orden.sena > 0 ? orden.sena : null,
      metodoPagoSena: safeString(orden.metodo_pago_sena),
      checklistItems,
      checklistNotas: checklistData?.notas || null,
      firmaRecepcion: checklistData?.firma_cliente ?? firmaRecepcionLote,
      firmaRecepcionMime: checklistData?.firma_mime || null,
      fotosIngreso: fotosData && fotosData.length > 0 ? fotosData : null,
      // Data layer del expediente (Task D2)
      codigoOrden: safeString(orden.codigo_orden),
      diagnostico: safeString(orden.diagnostico),
      costoFinal: typeof orden.costo_final === "number" ? orden.costo_final : null,
      totalCobrado: typeof orden.total_cobrado === "number" ? orden.total_cobrado : null,
      estadoCobro: safeString(orden.estado_cobro),
      descuentoCobro: typeof orden.descuento_cobro === "number" ? orden.descuento_cobro : null,
      motivoSinCobro: safeString(orden.motivo_sin_cobro),
      telefonoContacto: safeString(orden.telefono_contacto),
      metadataCampos,
      esReingreso: !!orden.es_reingreso,
      ordenOrigenNumero,
      fechaCompletado: orden.fecha_completado ? new Date(orden.fecha_completado) : null,
      emailEmpresa: safeString(org?.email),
      sucursal: sucursalObj ? {
        nombre: safeString(sucursalObj.nombre) || "",
        direccion: safeString(sucursalObj.direccion),
        telefono: safeString(sucursalObj.telefono),
      } : null,
      tecnicoNombre: safeString(tecnicoObj?.nombre),
      recibidoPorNombre: safeString(recibidoPorObj?.nombre),
      trabajos,
      garantia,
      cobros,
      timeline,
    }

    // Resolver terminología configurable y generar PDF
    const terminologia = await getTerminologia(organizationId!)
    pdfData.terminologia = terminologia
    const pdfBuffer = await generateOrdenPDF(pdfData)

    // Retornar PDF como descarga (convertir Buffer a Uint8Array)
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="orden-${orden.numero_orden}.pdf"`,
      },
    })
  } catch (error) {
    console.error("Error generating orden PDF:", error)
    return NextResponse.json(
      { error: "Error al generar PDF" },
      { status: 500 }
    )
  }
}
