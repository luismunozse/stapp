/**
 * Centralized selectors and domain constants for STApp E2E.
 *
 * STApp ships with ZERO data-testid attributes, so every selector here is
 * semantic (role + accessible name, label text, or visible copy) and mirrors
 * the actual Spanish UI strings in the codebase. Keeping them in one place means
 * a copy change breaks one line, not twenty specs.
 *
 * Source of truth verified against:
 *   - components/ordenes/* , components/tecnicos/* , components/caja/*
 *   - app/(auth)/login/page.tsx , app/(dashboard)/dashboard/page.tsx
 *   - lib/orden-state-machine.ts , middleware.ts
 */

export const ROUTES = {
  // Public
  landing: "/",
  login: "/login",
  registro: "/registro",
  forgotPassword: "/forgot-password",
  precios: "/precios",

  // Authenticated
  dashboard: "/dashboard",
  ordenes: "/ordenes",
  orden: (id: string) => `/ordenes/${id}`,
  clientes: "/clientes",
  tecnicos: "/tecnicos",
  tecnicosRanking: "/tecnicos/ranking",
  vendedores: "/vendedores",
  caja: "/caja",
  reportes: "/reportes",
  ventas: "/ventas",
  pos: "/pos",
  inventario: "/inventario",
  finanzas: "/finanzas",
  facturacion: "/facturacion",
  configuracion: "/configuracion",
  agenda: "/agenda",
  comisiones: "/comisiones",
  perfil: "/perfil",
} as const

/** Route guards as enforced by middleware.ts. */
export const ROUTE_GUARDS = {
  adminOnly: ["/tecnicos", "/vendedores", "/configuracion", "/emails", "/facturacion", "/inventario", "/finanzas"],
  adminOrVendedor: ["/ventas", "/pos", "/reportes", "/proveedores"],
} as const

/** EstadoOrden enum keys + labels from lib/orden-state-machine.ts. */
export const ESTADO_ORDEN = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "En Diagnóstico",
  PRESUPUESTADO: "Presupuestado",
  APROBADO: "Aprobado",
  EN_REPARACION: "En Reparación",
  ESPERANDO_REPUESTO: "Esperando Repuesto",
  REPARADO: "Reparado",
  ENTREGADO: "Entregado",
  ENTREGADO_SIN_REPARACION: "Retirado sin Reparación",
  ENTREGADO_SIN_COBRO: "Entregado sin Cobro",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin Reparación",
} as const

/** Valid transitions from lib/orden-state-machine.ts (for valid/invalid tests). */
export const TRANSICIONES_VALIDAS: Record<string, string[]> = {
  RECIBIDO: ["EN_DIAGNOSTICO", "PRESUPUESTADO", "EN_REPARACION", "CANCELADO", "SIN_REPARACION", "ENTREGADO_SIN_COBRO"],
  EN_DIAGNOSTICO: ["PRESUPUESTADO", "EN_REPARACION", "CANCELADO", "SIN_REPARACION", "ENTREGADO_SIN_COBRO"],
  PRESUPUESTADO: ["APROBADO", "EN_DIAGNOSTICO", "CANCELADO", "SIN_REPARACION"],
  APROBADO: ["EN_REPARACION", "CANCELADO"],
  EN_REPARACION: ["ESPERANDO_REPUESTO", "REPARADO", "CANCELADO", "SIN_REPARACION"],
  ESPERANDO_REPUESTO: ["EN_REPARACION", "REPARADO", "CANCELADO", "SIN_REPARACION"],
  REPARADO: ["ENTREGADO", "ENTREGADO_SIN_COBRO", "EN_REPARACION"],
  ENTREGADO: [],
  ENTREGADO_SIN_REPARACION: [],
  ENTREGADO_SIN_COBRO: [],
  CANCELADO: ["RECIBIDO"],
  SIN_REPARACION: ["RECIBIDO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO"],
}

/** Login form (app/(auth)/login/page.tsx). */
export const login = {
  email: { label: /email/i },
  password: { label: "Contraseña" },
  submit: { role: "button" as const, name: /iniciar sesi[oó]n|ingresar/i },
  rememberMe: /recordarme/i,
  forgotLink: /olvidaste|recuperar|forgot/i,
  registerLink: /registr|crear cuenta|sign up/i,
  errorMessage: /incorrect|inv[aá]lid|invalid|error|no autoriz|credencial/i,
}

/** Órdenes list + create wizard (components/ordenes/*). */
export const ordenes = {
  pageHeading: /Órdenes de Servicio/i,
  newButton: { role: "button" as const, name: /nueva/i },
  searchInput: /buscar por/i,
  filtersButton: { role: "button" as const, name: /^filtros$/i },
  emptyState: /no hay órdenes registradas/i,
  table: {
    colNumero: "# Orden",
    colEstado: "Estado",
    colCliente: "Cliente",
    colDispositivo: "Dispositivo",
    colTecnico: "Técnico",
  },
  // Create wizard (modal, 3 steps)
  form: {
    stepCliente: /Cliente y Equipo/i,
    stepDetalles: /Detalles/i,
    dispositivo: { label: /Modelo \/ Dispositivo/i },
    marca: { label: /^Marca$/i },
    problema: { label: /Problema Reportado/i },
    presupuesto: { label: /Presupuesto \(Opcional\)/i },
    tecnico: { label: /Técnico asignado/i },
    next: { role: "button" as const, name: /siguiente/i },
    prev: { role: "button" as const, name: /anterior/i },
    cancel: { role: "button" as const, name: /cancelar/i },
    submit: { role: "button" as const, name: /crear orden/i },
  },
  validation: {
    clienteRequerido: /El cliente es requerido/i,
    dispositivoRequerido: /El dispositivo es requerido/i,
    problemaRequerido: /El problema es requerido/i,
  },
}

/** Orden detail (components/ordenes/orden-detail.tsx + cards). */
export const ordenDetail = {
  heading: { role: "heading" as const, name: /^Orden\s/i },
  estadoCard: /^Estado$/,
  tecnicoCard: /Técnico Asignado/i,
  costosCard: /Presupuesto y Costos/i,
  cobrarButton: { role: "button" as const, name: /^cobrar$/i },
  diagnosticoField: /Diagnostico/i,
  tabs: {
    repuestos: /Repuestos/i,
    fotos: /^Fotos$/i,
    historial: /Historial/i,
  },
}

/** Técnicos (components/tecnicos/*). */
export const tecnicos = {
  pageHeading: /^Técnicos$/,
  newButton: { role: "button" as const, name: /nuevo técnico/i },
  search: /buscar por nombre o email/i,
  form: {
    dialogTitle: /Nuevo Técnico/i,
    nombre: { label: /Nombre \*/i },
    email: { label: /Email \*/i },
    password: { label: /Contraseña/i },
    comision: { label: /% Comisión/i },
    submit: { role: "button" as const, name: /guardar/i },
    comisionError: /El porcentaje de comisión debe estar entre 0 y 100/i,
  },
}

/** Caja / pagos (components/caja/*). */
export const caja = {
  pageHeading: /Caja Diaria/i,
  abrirButton: { role: "button" as const, name: /abrir caja/i },
  cerrarButton: { role: "button" as const, name: /cerrar caja/i },
  cajaCerrada: /Caja cerrada/i,
  cajaAbierta: /Caja abierta/i,
  tabs: {
    resumen: /^Resumen$/i,
    movimientos: /Movimientos Manuales/i,
    historial: /Historial de Cierres/i,
  },
  movimiento: {
    registrar: { role: "button" as const, name: /registrar movimiento/i },
    montoInvalido: /Ingrese un monto válido mayor a 0/i,
  },
}

/** Dashboard (app/(dashboard)/dashboard/page.tsx). */
export const dashboard = {
  heading: { role: "heading" as const, name: "Dashboard" },
  kpi: {
    ordenesPendientes: /Órdenes Pendientes/i,
    clientes: /^Clientes$/i,
    ingresosMes: /Ingresos del Mes/i,
    misOrdenesActivas: /Mis Órdenes Activas/i,
  },
  alertas: /^Alertas$/,
}

/** Reportes (components/reportes-avanzados/*). */
export const reportes = {
  heading: { role: "heading" as const, name: "Reportes" },
  exportButton: { role: "button" as const, name: /exportar/i },
  exportCsv: { role: "button" as const, name: /^CSV$/ },
  exportPdf: { role: "button" as const, name: /^PDF$/ },
  tabs: {
    tiempos: /Tiempos/i,
    fallas: /Fallas/i,
    rentabilidad: /^Rentabilidad$/i,
  },
}
