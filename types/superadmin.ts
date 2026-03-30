export interface SuperadminStats {
  totalOrganizations: number
  activeOrganizations: number
  totalUsers: number
  activeSubscriptions: number
  monthlyRevenue: number
  newOrgsThisMonth: number
  recentPayments: PaymentWithOrg[]
}

export interface OrganizationListItem {
  id: string
  nombre: string
  slug: string
  email: string | null
  telefono: string | null
  activo: boolean
  created_at: string
  usersCount: number
  subscription: {
    id: string
    status: SubscriptionStatus
    plans: {
      id: string
      nombre: string
      tipo: PlanType
    } | null
  } | null
}

export interface OrganizationDetail {
  id: string
  nombre: string
  nombre_mostrar: string | null
  slug: string
  email: string | null
  telefono: string | null
  direccion: string | null
  activo: boolean
  created_at: string
  updated_at: string
  logo_url: string | null
}

export interface OrganizationUser {
  id: string
  nombre: string
  email: string
  rol: UserRole
  email_verified: boolean
  created_at: string
}

export interface OrganizationUsage {
  organization_id: string
  ordenes_count: number
  ordenes_mes_actual: number
  tecnicos_count: number
  vendedores_count: number
  clientes_count: number
  storage_used_mb: number
  periodo_inicio: string
}

export interface SubscriptionWithPlan {
  id: string
  organization_id: string
  plan_id: string
  status: SubscriptionStatus
  billing_period: BillingPeriod | null
  payment_provider: PaymentProvider | null
  current_period_start: string | null
  current_period_end: string | null
  trial_end: string | null
  canceled_at: string | null
  cancel_at_period_end: boolean
  created_at: string
  plans: Plan | null
}

export interface Plan {
  id: string
  nombre: string
  tipo: PlanType
  descripcion: string | null
  precio_mensual: number
  precio_anual: number
  limite_ordenes: number | null
  limite_tecnicos: number | null
  limite_clientes: number | null
  limite_vendedores: number | null
  limite_storage_mb: number | null
  features: string[]
  activo: boolean
}

export interface PaymentWithOrg {
  id: string
  subscription_id?: string
  organization_id: string
  amount: number
  currency: string
  status: string
  payment_provider?: string | null
  provider_payment_id?: string | null
  invoice_url?: string | null
  receipt_url?: string | null
  paid_at: string | null
  created_at: string
  organization?: {
    nombre: string
    slug: string
  } | null
}

export interface SubscriptionListItem {
  id: string
  status: SubscriptionStatus
  billing_period: BillingPeriod | null
  current_period_end: string | null
  trial_end: string | null
  payment_provider: PaymentProvider | null
  cancel_at_period_end: boolean
  created_at: string
  organization: {
    id: string
    nombre: string
    slug: string
    activo: boolean
  }
  plans: {
    nombre: string
    tipo: PlanType
  } | null
}

export interface AuditLogWithRelations {
  id: string
  organization_id: string
  user_id: string | null
  action: AuditAction
  entity: string
  entity_id: string | null
  changes: Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
  users: {
    nombre: string
    email: string
  } | null
  organizations: {
    nombre: string
    slug: string
  } | null
  // Campos extendidos para superadmin
  performer_email?: string | null
  description?: string | null
}

// Enums
export type SubscriptionStatus = "ACTIVE" | "CANCELED" | "PAST_DUE" | "TRIALING"
export type BillingPeriod = "MONTHLY" | "YEARLY"
export type PaymentProvider = "MERCADOPAGO" | "REBILL"
export type PaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED"
export type PlanType = "FREE" | "PREMIUM"
export type UserRole = "ADMIN" | "TECNICO" | "VENDEDOR"
export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "LOGIN"
  | "LOGOUT"
  | "LOGIN_FAILED"
  | "TOGGLE_STATUS"
  | "BROADCAST"
  | "EMAIL_CAMPAIGN"
  | "CRON_RUN"
  | "SUBSCRIPTION_RENEW"
  | "TRIAL_EXTENSION"
  | "EXPORT"
  | "PLAN_TOGGLE"
  | "BULK_ACTION"
  | "TICKET_REPLY"
  | "VERIFY_EMAIL"

// Request/Response types
export interface OrganizationsListResponse {
  organizations: OrganizationListItem[]
  total: number
  page: number
  limit: number
}

export interface OrganizationDetailResponse {
  organization: OrganizationDetail
  users: OrganizationUser[]
  usage: OrganizationUsage | null
  subscription: SubscriptionWithPlan | null
  payments: PaymentWithOrg[]
}

export interface SubscriptionsListResponse {
  subscriptions: SubscriptionListItem[]
  total: number
  page: number
  limit: number
}

export interface PaymentsListResponse {
  payments: PaymentWithOrg[]
  total: number
  page: number
  limit: number
  totalAmount: number
}

export interface AuditLogsResponse {
  logs: AuditLogWithRelations[]
  total: number
  page: number
  limit: number
}

// ========================================
// MÓDULO PLANES - Types
// ========================================

export interface PlanWithUsage extends Plan {
  organizations_count: number
  active_subscriptions: number
  deleted_at: string | null
}

export interface PlanAudit {
  id: string
  plan_id: string
  changed_by_email: string
  action: 'CREATE' | 'UPDATE' | 'DISABLE' | 'ENABLE'
  before_data: Plan | null
  after_data: Plan | null
  created_at: string
}

export interface CreatePlanInput {
  nombre: string
  tipo: PlanType
  descripcion: string | null
  precio_mensual: number
  precio_anual: number
  moneda: string
  limite_ordenes: number | null
  limite_tecnicos: number | null
  limite_clientes: number | null
  limite_vendedores: number | null
  limite_storage_mb: number | null
  features: string[]
}

export interface UpdatePlanInput {
  nombre?: string
  descripcion?: string | null
  precio_mensual?: number
  precio_anual?: number
  limite_ordenes?: number | null
  limite_tecnicos?: number | null
  limite_clientes?: number | null
  limite_vendedores?: number | null
  limite_storage_mb?: number | null
  features?: string[]
}

// ========================================
// MÓDULO REPORTES/ANALYTICS - Types
// ========================================

export interface AnalyticsMetrics {
  mrr: MRRData[]
  churnRate: ChurnRateData[]
  newOrganizations: NewOrgsData[]
  planDistribution: PlanDistributionData
  paymentSuccessRate: PaymentSuccessData
  topOrganizations: TopOrgData[]
}

export interface MRRData {
  month: string // '2025-01'
  mrr: number
  growth: number // % vs mes anterior
}

export interface ChurnRateData {
  month: string
  rate: number // porcentaje
  canceled: number
  active: number
}

export interface NewOrgsData {
  month: string
  count: number
}

export interface PlanDistributionData {
  free: number
  premium: number
  total: number
}

export interface PaymentSuccessData {
  successful: number
  failed: number
  total: number
  successRate: number
}

export interface TopOrgData {
  id: string
  nombre: string
  slug: string
  totalRevenue: number
  planTipo: PlanType | null
  subscriptionStatus: SubscriptionStatus | null
}

export interface AnalyticsFilters {
  startDate: string
  endDate: string
  compareWith?: 'previous_period' | 'previous_year'
}

// ========================================
// MÓDULO SOPORTE - Types
// ========================================

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
export type TicketCategory = 'BILLING' | 'TECHNICAL' | 'FEATURE_REQUEST' | 'BUG' | 'OTHER'

export interface SupportTicket {
  id: string
  organization_id: string
  title: string
  category: TicketCategory
  priority: TicketPriority
  status: TicketStatus
  assigned_to_email: string | null
  assigned_at: string | null
  created_by_name: string | null
  created_by_email: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  closed_at: string | null
}

export interface SupportMessage {
  id: string
  ticket_id: string
  author_email: string
  author_name: string
  is_superadmin: boolean
  message: string
  attachments: Array<{ name: string; url: string; size: number }>
  created_at: string
}

export interface TicketWithRelations extends SupportTicket {
  organization: {
    id: string
    nombre: string
    slug: string
  }
  messagesCount: number
  lastMessage?: SupportMessage
}

export interface TicketDetail extends SupportTicket {
  organization: {
    id: string
    nombre: string
    slug: string
    email: string | null
  }
  messages: SupportMessage[]
}

export interface CreateTicketInput {
  organizationId: string
  title: string
  category: TicketCategory
  priority: TicketPriority
  message: string
}

export interface UpdateTicketInput {
  status?: TicketStatus
  priority?: TicketPriority
  assigned_to_email?: string | null
}
