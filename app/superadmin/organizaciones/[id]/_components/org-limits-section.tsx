"use client"

import { useState } from "react"
import { Settings, RotateCcw, Loader2, Infinity } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import type {
  OrganizationDetail,
  SubscriptionWithPlan,
  OrganizationUsage,
  OrganizationLimitOverrides,
  Plan,
} from "@/types/superadmin"

// ── Types ────────────────────────────────────────────────────────────────────

interface OrgLimitsSectionProps {
  organization: OrganizationDetail
  subscription: SubscriptionWithPlan | null
  usage: OrganizationUsage | null
  limitOverrides: OrganizationLimitOverrides | null
  onUpdated: () => void
}

/**
 * Each resource row: plan field and override field share the same key name;
 * usageField is a keyof OrganizationUsage to stay type-safe without `any`.
 */
interface ResourceDef {
  label: string
  planField: keyof Pick<
    Plan,
    | "limite_ordenes"
    | "limite_tecnicos"
    | "limite_vendedores"
    | "limite_clientes"
    | "limite_storage_mb"
  >
  overrideField: keyof Pick<
    OrganizationLimitOverrides,
    | "limite_ordenes"
    | "limite_tecnicos"
    | "limite_vendedores"
    | "limite_clientes"
    | "limite_storage_mb"
  >
  usageField: keyof Pick<
    OrganizationUsage,
    | "ordenes_mes_actual"
    | "tecnicos_count"
    | "vendedores_count"
    | "clientes_count"
    | "storage_used_mb"
  >
}

// ── Resource definitions ─────────────────────────────────────────────────────

const RESOURCES: ResourceDef[] = [
  {
    label: "Órdenes (mes)",
    planField: "limite_ordenes",
    overrideField: "limite_ordenes",
    usageField: "ordenes_mes_actual",
  },
  {
    label: "Técnicos",
    planField: "limite_tecnicos",
    overrideField: "limite_tecnicos",
    usageField: "tecnicos_count",
  },
  {
    label: "Vendedores",
    planField: "limite_vendedores",
    overrideField: "limite_vendedores",
    usageField: "vendedores_count",
  },
  {
    label: "Clientes",
    planField: "limite_clientes",
    overrideField: "limite_clientes",
    usageField: "clientes_count",
  },
  {
    label: "Storage (MB)",
    planField: "limite_storage_mb",
    overrideField: "limite_storage_mb",
    usageField: "storage_used_mb",
  },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function getEffectiveLimit(
  resource: ResourceDef,
  subscription: SubscriptionWithPlan | null,
  limitOverrides: OrganizationLimitOverrides | null
): number | null {
  const overrideValue = limitOverrides?.[resource.overrideField]
  if (overrideValue != null) return overrideValue

  const planValue = subscription?.plans?.[resource.planField]
  if (planValue != null) return planValue

  return null
}

function getUsageValue(
  resource: ResourceDef,
  usage: OrganizationUsage | null
): number {
  return usage?.[resource.usageField] ?? 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

// ── Sub-components ───────────────────────────────────────────────────────────

interface LimitRowProps {
  resource: ResourceDef
  effectiveLimit: number | null
  usageValue: number
  hasOverride: boolean
}

function LimitRow({ resource, effectiveLimit, usageValue, hasOverride }: LimitRowProps) {
  const isUnlimited = effectiveLimit === null
  const percentage = isUnlimited
    ? 0
    : clamp(Math.round((usageValue / effectiveLimit) * 100), 0, 100)

  const progressColor =
    percentage >= 90
      ? "bg-red-500"
      : percentage >= 70
        ? "bg-amber-500"
        : "bg-primary"

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">{resource.label}</span>
          {hasOverride && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200 leading-none">
              override
            </span>
          )}
        </div>
        <span className="text-muted-foreground tabular-nums">
          {usageValue.toLocaleString()}
          {" / "}
          {isUnlimited ? (
            <Infinity className="inline h-3.5 w-3.5 align-text-bottom" />
          ) : (
            effectiveLimit.toLocaleString()
          )}
        </span>
      </div>

      {!isUnlimited && (
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${progressColor}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function OrgLimitsSection({
  organization,
  subscription,
  usage,
  limitOverrides,
  onUpdated,
}: OrgLimitsSectionProps) {
  const { mutate, loading } = useSuperadminMutation()

  // ── Edit dialog state ────────────────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false)

  // Each field stores a string; empty string = "not changed by user"
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [motivo, setMotivo] = useState("")

  const openEditDialog = () => {
    // Prefill only from overrides — empty means "inherit from plan"
    const initial: Record<string, string> = {}
    for (const r of RESOURCES) {
      const override = limitOverrides?.[r.overrideField]
      initial[r.overrideField] = override != null ? String(override) : ""
    }
    setFieldValues(initial)
    setMotivo("")
    setEditOpen(true)
  }

  const handleSaveOverrides = async () => {
    // Build body with ONLY the fields the user actually filled in
    const changedFields: Record<string, number> = {}
    for (const r of RESOURCES) {
      const raw = fieldValues[r.overrideField]
      if (raw !== "" && raw !== undefined) {
        const num = Number(raw)
        if (!isNaN(num) && num >= 0) {
          changedFields[r.overrideField] = num
        }
      }
    }

    await mutate("/api/superadmin/subscriptions/limit-overrides", {
      method: "POST",
      body: {
        organizationId: organization.id,
        ...changedFields,
        ...(motivo ? { motivo } : {}),
      },
      successMessage: "Límites actualizados",
      onSuccess: () => {
        setEditOpen(false)
        setFieldValues({})
        setMotivo("")
        onUpdated()
      },
    })
  }

  // ── Restore dialog state ─────────────────────────────────────────────────
  const [restoreOpen, setRestoreOpen] = useState(false)

  const handleRestoreOverrides = async () => {
    await mutate(
      `/api/superadmin/subscriptions/limit-overrides?organizationId=${organization.id}`,
      {
        method: "DELETE",
        successMessage: "Límites restaurados",
        onSuccess: () => {
          setRestoreOpen(false)
          onUpdated()
        },
      }
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Límites de uso
              </CardTitle>
              <CardDescription>
                Consumo actual vs. límites del plan
                {limitOverrides !== null && (
                  <span className="ml-1 text-amber-600 font-medium">
                    · Con overrides activos
                  </span>
                )}
              </CardDescription>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {limitOverrides !== null && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 border-amber-200"
                  onClick={() => setRestoreOpen(true)}
                  disabled={loading}
                >
                  <RotateCcw className="h-4 w-4 mr-1.5" />
                  Restaurar al plan
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={openEditDialog}
                disabled={loading}
              >
                <Settings className="h-4 w-4 mr-1.5" />
                Editar límites
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="space-y-4">
            {RESOURCES.map((resource) => {
              const effectiveLimit = getEffectiveLimit(resource, subscription, limitOverrides)
              const usageValue = getUsageValue(resource, usage)
              const hasOverride = limitOverrides?.[resource.overrideField] != null

              return (
                <LimitRow
                  key={resource.overrideField}
                  resource={resource}
                  effectiveLimit={effectiveLimit}
                  usageValue={usageValue}
                  hasOverride={hasOverride}
                />
              )
            })}
          </div>

          {limitOverrides?.motivo && (
            <div className="mt-4 px-3 py-2 rounded-md bg-amber-50 border border-amber-100">
              <p className="text-xs text-amber-700">
                <span className="font-semibold">Motivo del override:</span>{" "}
                {limitOverrides.motivo}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Edit dialog ───────────────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar límites</DialogTitle>
            <DialogDescription>
              Override de límites para{" "}
              <span className="font-medium">{organization.nombre}</span>. Dejá
              vacío los campos que no querés cambiar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {RESOURCES.map((resource) => {
              const planLimit = subscription?.plans?.[resource.planField]
              const placeholder =
                planLimit != null ? `Plan: ${planLimit}` : "Plan: ∞"

              return (
                <div key={resource.overrideField} className="space-y-1.5">
                  <Label htmlFor={`limit-${resource.overrideField}`}>
                    {resource.label}
                  </Label>
                  <Input
                    id={`limit-${resource.overrideField}`}
                    type="number"
                    min={0}
                    step={1}
                    value={fieldValues[resource.overrideField] ?? ""}
                    onChange={(e) =>
                      setFieldValues((prev) => ({
                        ...prev,
                        [resource.overrideField]: e.target.value,
                      }))
                    }
                    placeholder={placeholder}
                  />
                </div>
              )
            })}

            <div className="space-y-1.5">
              <Label htmlFor="limit-motivo">Motivo (opcional)</Label>
              <Input
                id="limit-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej: acuerdo comercial especial"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button onClick={handleSaveOverrides} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Guardando...
                </>
              ) : (
                "Guardar límites"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Restore confirm dialog ────────────────────────────────────────── */}
      <ConfirmDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title="Restaurar límites al plan"
        description={`¿Eliminar los overrides de ${organization.nombre}? Los límites volverán a los del plan asignado.`}
        confirmText="Restaurar"
        variant="warning"
        loading={loading}
        onConfirm={handleRestoreOverrides}
      />
    </>
  )
}
