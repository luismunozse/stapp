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
  precio_mensual: number
  precio_anual: number
  limite_ordenes: number | null
  limite_tecnicos: number | null
  limite_clientes: number | null
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
}

// Enums
export type SubscriptionStatus = "ACTIVE" | "CANCELED" | "PAST_DUE" | "TRIALING"
export type BillingPeriod = "MONTHLY" | "YEARLY"
export type PaymentProvider = "STRIPE" | "MERCADOPAGO"
export type PaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED"
export type PlanType = "FREE" | "PREMIUM"
export type UserRole = "ADMIN" | "TECNICO" | "VENDEDOR"
export type AuditAction = "CREATE" | "UPDATE" | "DELETE"

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
