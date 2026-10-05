// Rutas del panel que el asistente puede citar como links.
// Data estática: se renderiza al system prompt (cacheado byte a byte).

export interface PanelRoute {
  ruta: string
  descripcion: string
}

export const panelRoutes: PanelRoute[] = [
  { ruta: "/dashboard", descripcion: "Dashboard principal con métricas del taller" },
  { ruta: "/ordenes", descripcion: "Órdenes de servicio (crear, listar, gestionar reparaciones)" },
  { ruta: "/ordenes/recepcion", descripcion: "Recibir varios equipos de un mismo cliente en una sola atención" },
  { ruta: "/clientes", descripcion: "Clientes (historial, cuenta corriente, importación)" },
  { ruta: "/tecnicos", descripcion: "Técnicos del taller y su rendimiento" },
  { ruta: "/vendedores", descripcion: "Vendedores y comisiones" },
  { ruta: "/inventario", descripcion: "Inventario, stock, depósitos y repuestos" },
  { ruta: "/servicios", descripcion: "Catálogo de servicios que ofrece el taller (trabajo cobrado, sin stock)" },
  { ruta: "/ventas", descripcion: "Ventas realizadas y devoluciones" },
  { ruta: "/pos", descripcion: "Punto de venta (vender accesorios y repuestos)" },
  { ruta: "/cotizaciones", descripcion: "Cotizaciones y presupuestos" },
  { ruta: "/facturacion", descripcion: "Remitos y cobros" },
  { ruta: "/caja", descripcion: "Caja diaria: ingresos, egresos y arqueo" },
  { ruta: "/finanzas", descripcion: "Finanzas: gastos y estado de resultados" },
  { ruta: "/proveedores", descripcion: "Proveedores" },
  { ruta: "/ordenes-compra", descripcion: "Órdenes de compra a proveedores" },
  { ruta: "/reportes", descripcion: "Reportes básicos" },
  { ruta: "/reportes-avanzados", descripcion: "Reportes avanzados (rentabilidad, predicción de repuestos, performance)" },
  { ruta: "/agenda", descripcion: "Agenda de turnos" },
  { ruta: "/catalogo", descripcion: "Catálogo online / e-commerce" },
  { ruta: "/emails", descripcion: "Campañas de email" },
  { ruta: "/leads", descripcion: "Leads capturados" },
  { ruta: "/comisiones", descripcion: "Liquidación de comisiones" },
  { ruta: "/soporte", descripcion: "Soporte (tickets al equipo de STApp)" },
  { ruta: "/perfil", descripcion: "Perfil del usuario y seguridad (contraseña, 2FA)" },
  { ruta: "/configuracion", descripcion: "Configuración general del taller" },
  { ruta: "/configuracion/whatsapp", descripcion: "Conectar y configurar WhatsApp (Meta Cloud API o Evolution)" },
  { ruta: "/configuracion/plantillas-whatsapp", descripcion: "Plantillas de mensajes de WhatsApp" },
  { ruta: "/configuracion/sucursales", descripcion: "Sucursales del taller" },
  { ruta: "/configuracion/billing", descripcion: "Plan, facturación y suscripción" },
  { ruta: "/configuracion/tipos-dispositivo", descripcion: "Tipos de dispositivo y checklists" },
  { ruta: "/configuracion/checklist", descripcion: "Checklists de recepción por tipo de dispositivo" },
  { ruta: "/configuracion/importaciones", descripcion: "Importación masiva de datos (Excel/CSV)" },
  { ruta: "/configuracion/kiosco", descripcion: "Modo kiosco (pantalla de estado y autoservicio)" },
  { ruta: "/configuracion/depositos", descripcion: "Depósitos de inventario" },
  { ruta: "/configuracion/categorias-gasto", descripcion: "Categorías de gastos" },
  { ruta: "/configuracion/gastos-recurrentes", descripcion: "Gastos recurrentes (alquiler, servicios, sueldos)" },
  { ruta: "/configuracion/recargos-metodo", descripcion: "Recargos/descuentos por método de pago" },
  { ruta: "/configuracion/label-templates", descripcion: "Plantillas de etiquetas con QR" },
  { ruta: "/configuracion/api-keys", descripcion: "API keys para la API REST" },
  { ruta: "/configuracion/webhooks", descripcion: "Webhooks salientes" },
  { ruta: "/configuracion/vocabulario", descripcion: "Vocabulario/terminología del rubro" },
]
