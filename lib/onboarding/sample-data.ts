import { supabaseAdmin } from "@/lib/supabase"

interface SampleDataResult {
  clientes: string[]
  ordenes: string[]
  inventario: string[]
}

/**
 * Genera datos de ejemplo para una organización recién creada.
 * Retorna los IDs de todas las entidades creadas para poder limpiarlas después.
 */
export async function generateSampleData(organizationId: string): Promise<SampleDataResult> {
  const result: SampleDataResult = { clientes: [], ordenes: [], inventario: [] }

  // 1. Crear clientes de ejemplo
  const clientes = [
    {
      nombre: "Juan Pérez",
      telefono: "1155001234",
      email: "juan.perez@ejemplo.com",
      dni: "30123456",
      organization_id: organizationId,
    },
    {
      nombre: "María García",
      telefono: "1155005678",
      email: "maria.garcia@ejemplo.com",
      dni: "28654321",
      organization_id: organizationId,
    },
    {
      nombre: "Carlos Rodríguez",
      telefono: "1155009012",
      email: null,
      dni: "35987654",
      organization_id: organizationId,
    },
  ]

  const { data: clientesCreados } = await supabaseAdmin
    .from("clientes")
    .insert(clientes)
    .select("id")

  if (clientesCreados) {
    result.clientes = clientesCreados.map((c) => c.id)
  }

  // 2. Crear inventario de ejemplo
  const inventario = [
    {
      codigo: "PAN-IP13",
      nombre: "Pantalla iPhone 13",
      descripcion: "Pantalla OLED original compatible",
      categoria: "Pantallas",
      tipo_dispositivo: "CELULAR",
      stock: 5,
      precio_compra: 15000,
      precio_venta: 35000,
      proveedor: "Proveedor Ejemplo",
      organization_id: organizationId,
    },
    {
      codigo: "BAT-SAM-S21",
      nombre: "Batería Samsung S21",
      descripcion: "Batería de reemplazo 4000mAh",
      categoria: "Baterías",
      tipo_dispositivo: "CELULAR",
      stock: 8,
      precio_compra: 5000,
      precio_venta: 12000,
      proveedor: "Proveedor Ejemplo",
      organization_id: organizationId,
    },
    {
      codigo: "CAR-USB-C",
      nombre: "Cargador USB-C Universal",
      descripcion: "Cargador rápido 25W",
      categoria: "Accesorios",
      tipo_dispositivo: "TODOS",
      stock: 15,
      precio_compra: 3000,
      precio_venta: 7500,
      proveedor: null,
      organization_id: organizationId,
    },
    {
      codigo: "FLEX-IP12",
      nombre: "Flex de carga iPhone 12",
      descripcion: "Cable flex puerto de carga Lightning",
      categoria: "Componentes",
      tipo_dispositivo: "CELULAR",
      stock: 3,
      precio_compra: 4500,
      precio_venta: 10000,
      proveedor: "Proveedor Ejemplo",
      organization_id: organizationId,
    },
    {
      codigo: "TEC-NOT-HP",
      nombre: "Teclado Notebook HP",
      descripcion: "Teclado español para HP Pavilion",
      categoria: "Componentes",
      tipo_dispositivo: "COMPUTADORA",
      stock: 2,
      precio_compra: 8000,
      precio_venta: 18000,
      proveedor: null,
      organization_id: organizationId,
    },
  ]

  const { data: inventarioCreado } = await supabaseAdmin
    .from("inventario")
    .insert(inventario)
    .select("id")

  if (inventarioCreado) {
    result.inventario = inventarioCreado.map((i) => i.id)
  }

  // 3. Crear órdenes de ejemplo (si hay clientes creados)
  if (result.clientes.length >= 2) {
    // Obtener número de orden siguiente
    const { data: counterData } = await supabaseAdmin
      .rpc("get_next_order_number", { org_id: organizationId })

    const baseNumber = counterData || 1

    const ordenes = [
      {
        numero_orden: baseNumber,
        cliente_id: result.clientes[0],
        organization_id: organizationId,
        dispositivo: "iPhone 13 Pro",
        tipo_dispositivo: "CELULAR",
        problema_reportado: "Pantalla rota por caída. No enciende correctamente.",
        estado: "RECIBIDO",
        presupuesto: null,
        fecha_ingreso: new Date().toISOString(),
        marca: "Apple",
        modelo: "iPhone 13 Pro",
        color: "Azul Sierra",
        observaciones: "Equipo con funda protectora. Cliente requiere presupuesto antes de reparar.",
      },
      {
        numero_orden: baseNumber + 1,
        cliente_id: result.clientes[1],
        organization_id: organizationId,
        dispositivo: "Samsung Galaxy S21",
        tipo_dispositivo: "CELULAR",
        problema_reportado: "Batería se descarga muy rápido. No dura más de 2 horas.",
        estado: "EN_REPARACION",
        presupuesto: 15000,
        fecha_ingreso: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        marca: "Samsung",
        modelo: "Galaxy S21",
        color: "Negro",
        diagnostico: "Batería degradada al 45% de capacidad. Se procede a cambio.",
      },
    ]

    // Incrementar el contador una vez más (ya usamos get_next que incrementa)
    await supabaseAdmin.rpc("get_next_order_number", { org_id: organizationId })

    const { data: ordenesCreadas } = await supabaseAdmin
      .from("ordenes_servicio")
      .insert(ordenes)
      .select("id")

    if (ordenesCreadas) {
      result.ordenes = ordenesCreadas.map((o) => o.id)
    }
  }

  // 4. Guardar IDs en onboarding_progress y marcar has_sample_data
  await supabaseAdmin
    .from("onboarding_progress")
    .upsert({
      organization_id: organizationId,
      sample_data_loaded: true,
      sample_entity_ids: result,
    }, { onConflict: "organization_id" })

  await supabaseAdmin
    .from("organizations")
    .update({ has_sample_data: true })
    .eq("id", organizationId)

  return result
}

/**
 * Elimina todos los datos de ejemplo de una organización.
 */
export async function cleanSampleData(organizationId: string): Promise<void> {
  // Obtener IDs guardados
  const { data: progress } = await supabaseAdmin
    .from("onboarding_progress")
    .select("sample_entity_ids")
    .eq("organization_id", organizationId)
    .single()

  if (!progress?.sample_entity_ids) return

  const ids = progress.sample_entity_ids as SampleDataResult

  // Eliminar en orden inverso (por dependencias FK)
  if (ids.ordenes?.length) {
    await supabaseAdmin
      .from("ordenes_servicio")
      .delete()
      .in("id", ids.ordenes)
  }

  if (ids.inventario?.length) {
    await supabaseAdmin
      .from("inventario")
      .delete()
      .in("id", ids.inventario)
  }

  if (ids.clientes?.length) {
    await supabaseAdmin
      .from("clientes")
      .delete()
      .in("id", ids.clientes)
  }

  // Limpiar flags
  await supabaseAdmin
    .from("onboarding_progress")
    .update({
      sample_data_loaded: false,
      sample_entity_ids: {},
    })
    .eq("organization_id", organizationId)

  await supabaseAdmin
    .from("organizations")
    .update({ has_sample_data: false })
    .eq("id", organizationId)
}
