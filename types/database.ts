// Tipos generados para Supabase
// Ejecutar `npx supabase gen types typescript` para regenerar desde la DB

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// ========================================
// ENUMS
// ========================================

export type UserRole = "ADMIN" | "TECNICO" | "VENDEDOR"

export type EstadoOrden =
  | "RECIBIDO"
  | "EN_DIAGNOSTICO"
  | "PRESUPUESTADO"
  | "APROBADO"
  | "EN_REPARACION"
  | "ESPERANDO_REPUESTO"
  | "REPARADO"
  | "ENTREGADO"
  | "ENTREGADO_SIN_REPARACION"
  | "ENTREGADO_SIN_COBRO"
  | "CANCELADO"
  | "SIN_REPARACION"

export type TipoDispositivoBase =
  | "CELULAR"
  | "COMPUTADORA"
  | "TABLET"
  | "CONSOLA"
  | "SMARTWATCH"
  | "ACCESORIOS"
  | "TODOS"

// Acepta tipos base y tipos personalizados (cualquier string)
export type TipoDispositivo = TipoDispositivoBase | (string & {})

export type EstadoPago = "PENDIENTE" | "PAGADO_PARCIAL" | "PAGADO" | "ANULADA"

export type EstadoCotizacion = "BORRADOR" | "ENVIADA" | "ACEPTADA" | "RECHAZADA"

export type EstadoGarantia = "ACTIVA" | "VENCIDA" | "RECLAMADA"

export type EstadoReclamo =
  | "PENDIENTE"
  | "EN_REVISION"
  | "ACEPTADO"
  | "RECHAZADO"
  | "RESUELTO"

export type TipoFoto = "INGRESO" | "DIAGNOSTICO" | "COMPONENTE" | "REPARACION" | "ENTREGA"

export type TipoNotificacion =
  | "CAMBIO_ESTADO"
  | "PRESUPUESTO_DEFINIDO"
  | "GARANTIA_CREADA"
  | "RECORDATORIO_RETIRO"

export type CanalNotificacion = "EMAIL" | "WHATSAPP"

export type EstadoNotificacion = "ENVIADO" | "FALLIDO" | "PENDIENTE"

export type TipoChecklist = "BOOLEAN" | "TEXT" | "SELECT"

export type CategoriaChecklist =
  | "CONDICION_FISICA"
  | "ACCESORIOS"
  | "FUNCIONAL"
  | "OTRO"
  | "GENERAL"

export type MetodoPago = "EFECTIVO" | "TRANSFERENCIA" | "TARJETA_DEBITO" | "TARJETA_CREDITO" | "MERCADOPAGO" | "CUENTA_CORRIENTE" | "OTRO"

export type MetodoPagoVenta = "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "TARJETA_DEBITO" | "TARJETA_CREDITO" | "MERCADOPAGO" | "CUENTA_CORRIENTE" | "OTRO"

export type EstadoVenta = "COMPLETADA" | "ANULADA"

export type EstadoGarantiaVenta = "ACTIVA" | "VENCIDA" | "RECLAMADA"

// ========================================
// TABLE TYPES
// ========================================

export interface Organization {
  id: string
  nombre: string
  slug: string
  email: string | null
  telefono: string | null
  direccion: string | null
  activo: boolean
  created_at: string
  updated_at: string
  logo_url: string | null
  logo_path: string | null
  nombre_mostrar: string
  notificaciones_email: boolean
  notificaciones_whatsapp: boolean
  dias_recordatorio: number
  moneda: string
  zona_horaria: string
}

export interface OrganizationCounters {
  id: string
  organization_id: string
  next_order_number: number
  next_quote_number: number
  next_invoice_number: number
}

export interface User {
  id: string
  email: string
  password: string
  nombre: string
  rol: UserRole
  organization_id: string
  created_at: string
  updated_at: string
  reset_token: string | null
  reset_token_expiry: string | null
  avatar_url: string | null
}

export interface Cliente {
  id: string
  nombre: string
  telefono: string
  email: string | null
  direccion: string | null
  dni: string | null
  organization_id: string
  created_at: string
  updated_at: string
}

export interface OrdenServicio {
  id: string
  numero_orden: number
  cliente_id: string
  tecnico_id: string | null
  organization_id: string
  dispositivo: string
  tipo_dispositivo: TipoDispositivo
  problema_reportado: string
  estado: EstadoOrden
  presupuesto: number | null
  costo_final: number | null
  fecha_ingreso: string
  fecha_prometida: string | null
  fecha_completado: string | null
  observaciones: string | null
  diagnostico: string | null
}

export interface FotoOrden {
  id: string
  orden_id: string
  url: string
  storage_path: string
  mime: string
  size: number | null
  descripcion: string | null
  tipo: TipoFoto
  created_at: string
}

export interface Inventario {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  categoria: string
  tipo_dispositivo: TipoDispositivo
  stock: number
  precio_compra: number
  precio_venta: number
  proveedor: string | null
  organization_id: string
  created_at: string
  updated_at: string
}

export interface RepuestoOrden {
  id: string
  orden_id: string
  inventario_id: string
  cantidad: number
  precio_unitario: number
}

export interface Factura {
  id: string
  orden_id: string
  numero_factura: string
  fecha: string
  subtotal: number
  iva: number
  total: number
  monto_abonado: number
  estado_pago: EstadoPago
}

export interface PagoParcial {
  id: string
  factura_id: string
  monto: number
  metodo_pago: MetodoPago
  fecha: string
  numero_referencia: string | null
  observaciones: string | null
}

export interface Proveedor {
  id: string
  nombre: string
  telefono: string | null
  whatsapp: string | null
  email: string | null
  direccion: string | null
  website: string | null
  notas: string | null
  activo: boolean
  organization_id: string
  created_at: string
  updated_at: string
}

export interface Cotizacion {
  id: string
  orden_id: string
  numero_cotizacion: string
  estado: EstadoCotizacion
  fecha_vencimiento: string | null
  notas: string | null
  subtotal: number
  iva: number
  total: number
  created_at: string
  updated_at: string
  firma_url: string | null
  firma_path: string | null
  fecha_aprobacion: string | null
}

export interface ItemCotizacion {
  id: string
  cotizacion_id: string
  descripcion: string
  cantidad: number
  precio_unitario: number
  subtotal: number
}

export interface Garantia {
  id: string
  orden_id: string
  dias_validez: number
  fecha_inicio: string
  fecha_vencimiento: string
  estado: EstadoGarantia
  notas: string | null
  created_at: string
}

export interface ReclamoGarantia {
  id: string
  garantia_id: string
  descripcion: string
  estado: EstadoReclamo
  orden_reparacion_id: string | null
  resolucion: string | null
  fecha_reclamo: string
  fecha_resolucion: string | null
}

export interface ChecklistTemplate {
  id: string
  organization_id: string
  nombre: string
  activo: boolean
  created_at: string
  updated_at: string
}

export interface ChecklistTemplateItem {
  id: string
  template_id: string
  label: string
  tipo: TipoChecklist
  categoria: CategoriaChecklist
  opciones: string | null
  orden: number
  requerido: boolean
}

export interface ChecklistRecepcion {
  id: string
  orden_id: string
  template_id: string
  valores: string
  notas: string | null
  created_at: string
  updated_at: string
  firma_url: string | null
  firma_path: string | null
}

export interface NotificationLog {
  id: string
  organization_id: string
  orden_id: string | null
  garantia_id: string | null
  cliente_id: string
  tipo: TipoNotificacion
  canal: CanalNotificacion
  estado: EstadoNotificacion
  destinatario: string
  asunto: string | null
  contenido: string
  error_message: string | null
  metadata: string | null
  created_at: string
}

export interface AuditLog {
  id: string
  organization_id: string
  user_id: string
  action: string
  entity: string
  entity_id: string
  changes: Json | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export interface UserNotification {
  id: string
  organization_id: string
  user_id: string
  title: string
  body: string
  type: string
  icon: string | null
  action_url: string | null
  orden_id: string | null
  cliente_id: string | null
  read_at: string | null
  created_at: string
}

// ========================================
// DATABASE INTERFACE
// ========================================

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: Organization
        Insert: Omit<Organization, "id" | "created_at" | "updated_at"> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<Organization, "id">>
      }
      organization_counters: {
        Row: OrganizationCounters
        Insert: Omit<OrganizationCounters, "id"> & { id?: string }
        Update: Partial<Omit<OrganizationCounters, "id">>
      }
      users: {
        Row: User
        Insert: Omit<User, "id" | "created_at" | "updated_at"> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<User, "id">>
      }
      clientes: {
        Row: Cliente
        Insert: Omit<Cliente, "id" | "created_at" | "updated_at"> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<Cliente, "id">>
      }
      ordenes_servicio: {
        Row: OrdenServicio
        Insert: Omit<OrdenServicio, "id"> & { id?: string }
        Update: Partial<Omit<OrdenServicio, "id">>
      }
      fotos_orden: {
        Row: FotoOrden
        Insert: Omit<FotoOrden, "id" | "created_at"> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<FotoOrden, "id">>
      }
      inventario: {
        Row: Inventario
        Insert: Omit<Inventario, "id" | "created_at" | "updated_at"> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<Inventario, "id">>
      }
      repuestos_orden: {
        Row: RepuestoOrden
        Insert: Omit<RepuestoOrden, "id"> & { id?: string }
        Update: Partial<Omit<RepuestoOrden, "id">>
      }
      facturas: {
        Row: Factura
        Insert: Omit<Factura, "id"> & { id?: string }
        Update: Partial<Omit<Factura, "id">>
      }
      pagos_parciales: {
        Row: PagoParcial
        Insert: Omit<PagoParcial, "id"> & { id?: string }
        Update: Partial<Omit<PagoParcial, "id">>
      }
      proveedores: {
        Row: Proveedor
        Insert: Omit<Proveedor, "id" | "created_at" | "updated_at"> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<Proveedor, "id">>
      }
      cotizaciones: {
        Row: Cotizacion
        Insert: Omit<Cotizacion, "id" | "created_at" | "updated_at"> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<Cotizacion, "id">>
      }
      items_cotizacion: {
        Row: ItemCotizacion
        Insert: Omit<ItemCotizacion, "id"> & { id?: string }
        Update: Partial<Omit<ItemCotizacion, "id">>
      }
      garantias: {
        Row: Garantia
        Insert: Omit<Garantia, "id" | "created_at"> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<Garantia, "id">>
      }
      reclamos_garantia: {
        Row: ReclamoGarantia
        Insert: Omit<ReclamoGarantia, "id"> & { id?: string }
        Update: Partial<Omit<ReclamoGarantia, "id">>
      }
      checklist_templates: {
        Row: ChecklistTemplate
        Insert: Omit<ChecklistTemplate, "id" | "created_at" | "updated_at"> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<ChecklistTemplate, "id">>
      }
      checklist_template_items: {
        Row: ChecklistTemplateItem
        Insert: Omit<ChecklistTemplateItem, "id"> & { id?: string }
        Update: Partial<Omit<ChecklistTemplateItem, "id">>
      }
      checklist_recepcion: {
        Row: ChecklistRecepcion
        Insert: Omit<ChecklistRecepcion, "id" | "created_at" | "updated_at"> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<ChecklistRecepcion, "id">>
      }
      notification_logs: {
        Row: NotificationLog
        Insert: Omit<NotificationLog, "id" | "created_at"> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<NotificationLog, "id">>
      }
      audit_logs: {
        Row: AuditLog
        Insert: Omit<AuditLog, "id" | "created_at"> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<AuditLog, "id">>
      }
      user_notifications: {
        Row: UserNotification
        Insert: Omit<UserNotification, "id" | "created_at"> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<UserNotification, "id">>
      }
      leads: {
        Row: Lead
        Insert: Omit<Lead, "id" | "created_at" | "updated_at"> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<Lead, "id">>
      }
      chatbot_conversaciones: {
        Row: ChatbotConversacion
        Insert: Omit<ChatbotConversacion, "id" | "created_at" | "updated_at"> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<ChatbotConversacion, "id">>
      }
      chatbot_mensajes: {
        Row: ChatbotMensaje
        Insert: Omit<ChatbotMensaje, "id" | "created_at"> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<ChatbotMensaje, "id">>
      }
      catalogo_config: {
        Row: CatalogoConfig
        Insert: Omit<CatalogoConfig, "id" | "created_at" | "updated_at"> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<CatalogoConfig, "id">>
      }
      catalogo_categorias: {
        Row: CatalogoCategoria
        Insert: Omit<CatalogoCategoria, "id" | "created_at" | "updated_at"> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<CatalogoCategoria, "id">>
      }
      catalogo_items: {
        Row: CatalogoItem
        Insert: Omit<CatalogoItem, "id" | "created_at" | "updated_at"> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<CatalogoItem, "id">>
      }
    }
    Enums: {
      user_role: UserRole
      estado_orden: EstadoOrden
      tipo_dispositivo: TipoDispositivo
      estado_pago: EstadoPago
      estado_cotizacion: EstadoCotizacion
      estado_garantia: EstadoGarantia
      estado_reclamo: EstadoReclamo
      tipo_foto: TipoFoto
      tipo_notificacion: TipoNotificacion
      canal_notificacion: CanalNotificacion
      estado_notificacion: EstadoNotificacion
      tipo_checklist: TipoChecklist
      categoria_checklist: CategoriaChecklist
      metodo_pago: MetodoPago
      estado_lead: EstadoLead
      origen_lead: OrigenLead
      tipo_mensaje_chatbot: TipoMensajeChatbot
    }
  }
}

// ========================================
// HELPER TYPES
// ========================================

// Orden con relaciones
export interface OrdenConRelaciones extends OrdenServicio {
  cliente?: Cliente
  tecnico?: User
  fotos?: FotoOrden[]
  repuestos?: (RepuestoOrden & { inventario?: Inventario })[]
  facturas?: Factura[]
  cotizaciones?: Cotizacion[]
  garantia?: Garantia
  checklist?: ChecklistRecepcion
}

// Cliente con sus ordenes
export interface ClienteConOrdenes extends Cliente {
  ordenes?: OrdenServicio[]
}

// Inventario con uso en ordenes
export interface InventarioConUso extends Inventario {
  _count?: {
    repuestos: number
  }
}

// ========================================
// VENTAS TYPES
// ========================================

export interface Venta {
  id: string
  numero_venta: number
  cliente_id: string | null
  cliente_nombre: string
  cliente_telefono: string | null
  vendedor_id: string
  subtotal: number
  descuento: number
  total: number
  metodo_pago: MetodoPagoVenta
  estado: EstadoVenta
  observaciones: string | null
  organization_id: string
  created_at: string
  updated_at: string
}

export interface ItemVenta {
  id: string
  venta_id: string
  inventario_id: string | null
  descripcion: string
  cantidad: number
  precio_unitario: number
  subtotal: number
  dias_garantia: number
}

export interface GarantiaVenta {
  id: string
  venta_id: string
  item_venta_id: string
  numero_garantia: string
  dias_validez: number
  fecha_inicio: string
  fecha_vencimiento: string
  estado: EstadoGarantiaVenta
  organization_id: string
  created_at: string
}

// Venta con relaciones
export interface VentaConRelaciones extends Venta {
  cliente?: Cliente | null
  vendedor?: User
  items?: (ItemVenta & { inventario?: Inventario | null })[]
  garantias?: GarantiaVenta[]
}

// ========================================
// CHATBOT TYPES
// ========================================

export type EstadoLead =
  | "NUEVO"
  | "CONTACTADO"
  | "CALIFICADO"
  | "CONVERTIDO"
  | "DESCARTADO"

export type OrigenLead = "CHATBOT" | "FORMULARIO" | "OTRO"

export type TipoMensajeChatbot = "USER" | "ASSISTANT" | "SYSTEM"

export interface Lead {
  id: string
  nombre: string | null
  email: string | null
  telefono: string | null
  empresa: string | null
  estado: EstadoLead
  origen: OrigenLead
  interes: string | null
  plan_interes: string | null
  organization_id: string | null
  assigned_to: string | null
  notas: string | null
  ultima_interaccion: string | null
  created_at: string
  updated_at: string
}

export interface ChatbotConversacion {
  id: string
  session_id: string
  lead_id: string | null
  ip_address: string | null
  user_agent: string | null
  referrer: string | null
  activa: boolean
  lead_capturado: boolean
  created_at: string
  updated_at: string
}

export interface ChatbotMensaje {
  id: string
  conversacion_id: string
  tipo: TipoMensajeChatbot
  contenido: string
  modelo: string | null
  tokens_usados: number | null
  tiempo_respuesta_ms: number | null
  intencion_detectada: string | null
  confianza: number | null
  created_at: string
}

// Lead con relaciones
export interface LeadConRelaciones extends Lead {
  organization?: Organization | null
  assigned_user?: User | null
  conversacion?: ChatbotConversacion
  mensajes_count?: number
}

// ========================================
// CATÁLOGO PÚBLICO TYPES
// ========================================

export type TipoCatalogoItem = "PRODUCTO" | "SERVICIO"

export interface CatalogoConfig {
  id: string
  organization_id: string
  slug: string
  titulo: string | null
  descripcion: string | null
  color_primary: string | null
  whatsapp: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

export interface CatalogoCategoria {
  id: string
  organization_id: string
  nombre: string
  descripcion: string | null
  imagen_url: string | null
  orden: number
  activo: boolean
  created_at: string
  updated_at: string
}

export interface CatalogoItem {
  id: string
  organization_id: string
  categoria_id: string | null
  inventario_id: string | null
  tipo: TipoCatalogoItem
  nombre: string
  descripcion: string | null
  precio: number | null
  precio_hasta: number | null
  imagen_url: string | null
  imagenes: string[]
  etiquetas: string[]
  stock: number | null
  activo: boolean
  orden: number
  created_at: string
  updated_at: string
}

// Item con stock resuelto desde inventario si está linkeado
export interface CatalogoItemConStock extends CatalogoItem {
  categoria?: CatalogoCategoria | null
  stock_disponible: number | null  // null = sin tracking; n = stock real (resuelto)
  inventario?: Inventario | null
}

// Vista pública del catálogo (lo que ve el cliente)
export interface CatalogoPublico {
  config: Pick<CatalogoConfig, "slug" | "titulo" | "descripcion" | "color_primary" | "whatsapp">
  organizacion: Pick<Organization, "id" | "nombre" | "logo_url" | "telefono" | "moneda">
  categorias: CatalogoCategoria[]
}
