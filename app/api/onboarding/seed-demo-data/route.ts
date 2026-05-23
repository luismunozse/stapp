import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * POST /api/onboarding/seed-demo-data
 *
 * Carga datos de ejemplo (3 clientes, 5 items de inventario, 2 órdenes)
 * en la organización del usuario autenticado para que pueda explorar
 * el sistema sin tener que cargar datos reales.
 *
 * Sólo permite seedear si la org NO tiene clientes ni órdenes
 * (evita duplicación). Todos los items quedan prefijados con "[demo] "
 * en su descripción para que el usuario los pueda identificar y borrar.
 */
export async function POST() {
  try {
    const { error, organizationId, userId } = await requireAuth()
    if (error) return error

    // Guard: solo permitir seedear si la org está vacía
    const [clientesRes, ordenesRes] = await Promise.all([
      supabaseAdmin
        .from("clientes")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId!),
      supabaseAdmin
        .from("ordenes_servicio")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId!),
    ])

    if ((clientesRes.count ?? 0) > 0 || (ordenesRes.count ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            "Ya tenés clientes o órdenes cargadas. Los datos de ejemplo solo se pueden cargar en cuentas vacías.",
        },
        { status: 400 }
      )
    }

    // 1. Clientes de ejemplo (nombres argentinos)
    const clientesPayload = [
      {
        nombre: "Juan Pérez",
        telefono: "1155001234",
        email: "juan.perez@ejemplo.com",
        organization_id: organizationId!,
      },
      {
        nombre: "Laura Gómez",
        telefono: "1155005678",
        email: "laura.gomez@ejemplo.com",
        organization_id: organizationId!,
      },
      {
        nombre: "Servicio Express SRL",
        telefono: "1155009012",
        email: "contacto@servicioexpress.com.ar",
        organization_id: organizationId!,
      },
    ]

    const { data: clientesCreados, error: clientesErr } = await supabaseAdmin
      .from("clientes")
      .insert(clientesPayload)
      .select("id")

    if (clientesErr) throw clientesErr
    const clientsCreated = clientesCreados?.length ?? 0

    // 2. Inventario típico de taller de celulares/PCs
    const inventarioPayload = [
      {
        codigo: "DEMO-CAR-IPH-L",
        nombre: "Cargador iPhone Lightning",
        descripcion: "[demo] Cargador USB-A a Lightning 1m",
        categoria: "Accesorios",
        tipo_dispositivo: "CELULAR",
        stock: 12,
        precio_compra: 2500,
        precio_venta: 6500,
        proveedor: "Demo Proveedor",
        organization_id: organizationId!,
      },
      {
        codigo: "DEMO-VID-IPH12",
        nombre: "Vidrio templado iPhone 12",
        descripcion: "[demo] Vidrio templado 9H full glue",
        categoria: "Accesorios",
        tipo_dispositivo: "CELULAR",
        stock: 20,
        precio_compra: 800,
        precio_venta: 2500,
        proveedor: "Demo Proveedor",
        organization_id: organizationId!,
      },
      {
        codigo: "DEMO-BAT-IPH11",
        nombre: "Batería iPhone 11",
        descripcion: "[demo] Batería de reemplazo 3110mAh",
        categoria: "Baterías",
        tipo_dispositivo: "CELULAR",
        stock: 6,
        precio_compra: 7500,
        precio_venta: 18000,
        proveedor: "Demo Proveedor",
        organization_id: organizationId!,
      },
      {
        codigo: "DEMO-HDMI-2M",
        nombre: "Cable HDMI 2m",
        descripcion: "[demo] Cable HDMI 4K 2 metros",
        categoria: "Accesorios",
        tipo_dispositivo: "TODOS",
        stock: 15,
        precio_compra: 1500,
        precio_venta: 4000,
        proveedor: "Demo Proveedor",
        organization_id: organizationId!,
      },
      {
        codigo: "DEMO-MOUSE-USB",
        nombre: "Mouse genérico USB",
        descripcion: "[demo] Mouse óptico USB 1000dpi",
        categoria: "Accesorios",
        tipo_dispositivo: "COMPUTADORA",
        stock: 10,
        precio_compra: 1800,
        precio_venta: 4500,
        proveedor: "Demo Proveedor",
        organization_id: organizationId!,
      },
    ]

    const { data: inventarioCreado, error: invErr } = await supabaseAdmin
      .from("inventario")
      .insert(inventarioPayload)
      .select("id")

    if (invErr) throw invErr
    const productsCreated = inventarioCreado?.length ?? 0

    // 3. Órdenes de ejemplo: dos estados distintos para mostrar el flujo
    let ordersCreated = 0
    if (clientesCreados && clientesCreados.length >= 2) {
      // Obtener próximo número de orden de forma atómica
      const { data: nextNumber } = await supabaseAdmin.rpc(
        "get_next_order_number",
        { org_id: organizationId! }
      )
      const baseNumber: number = typeof nextNumber === "number" ? nextNumber : 1

      // Estado_orden enum (post-migración 005): RECIBIDO, EN_DIAGNOSTICO,
      // PRESUPUESTADO, APROBADO, EN_REPARACION, ESPERANDO_REPUESTO, etc.
      // La spec pidió "PENDIENTE" y "EN_PROCESO" pero esos no existen en
      // el enum actual. Mapeamos al equivalente más cercano: RECIBIDO
      // (pendiente de diagnóstico) y EN_REPARACION (en proceso).
      const ordenesPayload = [
        {
          numero_orden: baseNumber,
          cliente_id: clientesCreados[0].id,
          tecnico_id: userId,
          organization_id: organizationId!,
          dispositivo: "iPhone 11",
          tipo_dispositivo: "CELULAR",
          problema_reportado:
            "[demo] No carga la batería. Cliente reporta que se apaga al desconectar el cable.",
          estado: "RECIBIDO",
          fecha_ingreso: new Date().toISOString(),
          observaciones: "[demo] Orden de ejemplo cargada automáticamente.",
        },
        {
          numero_orden: baseNumber + 1,
          cliente_id: clientesCreados[1].id,
          tecnico_id: userId,
          organization_id: organizationId!,
          dispositivo: "Notebook HP Pavilion",
          tipo_dispositivo: "COMPUTADORA",
          problema_reportado:
            "[demo] Notebook lenta, pide cambio de disco a SSD.",
          estado: "EN_REPARACION",
          presupuesto: 45000,
          fecha_ingreso: new Date(
            Date.now() - 2 * 24 * 60 * 60 * 1000
          ).toISOString(),
          diagnostico: "[demo] Disco HDD con sectores defectuosos. Migrar a SSD 480GB.",
          observaciones: "[demo] Orden de ejemplo cargada automáticamente.",
        },
      ]

      // Avanzar el contador para reflejar las 2 órdenes creadas
      await supabaseAdmin.rpc("get_next_order_number", {
        org_id: organizationId!,
      })

      const { data: ordenesCreadas, error: ordErr } = await supabaseAdmin
        .from("ordenes_servicio")
        .insert(ordenesPayload)
        .select("id")

      if (ordErr) throw ordErr
      ordersCreated = ordenesCreadas?.length ?? 0
    }

    // Marcar flag para que el usuario sepa que tiene datos de ejemplo
    await supabaseAdmin
      .from("organizations")
      .update({ has_sample_data: true })
      .eq("id", organizationId!)

    return NextResponse.json({
      success: true,
      message:
        "Datos de ejemplo cargados. Podés identificarlos por el prefijo '[demo]' y borrarlos cuando quieras.",
      clientsCreated,
      productsCreated,
      ordersCreated,
    })
  } catch (err) {
    console.error("Error seeding demo data:", err)
    return NextResponse.json(
      { error: "No se pudieron cargar los datos de ejemplo" },
      { status: 500 }
    )
  }
}
