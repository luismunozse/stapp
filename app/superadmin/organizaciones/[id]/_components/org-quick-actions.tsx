"use client"

import { useState } from "react"
import {
  Calendar,
  CreditCard,
  XCircle,
  PowerOff,
  Power,
  Trash2,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  useSuperadminMutation,
  useSuperadminFetch,
} from "@/hooks/use-superadmin-fetch"
import type { OrganizationDetail, SubscriptionWithPlan, PlanWithUsage } from "@/types/superadmin"

interface OrgQuickActionsProps {
  organization: OrganizationDetail
  subscription: SubscriptionWithPlan | null
  onUpdated: () => void
}

export function OrgQuickActions({
  organization,
  subscription,
  onUpdated,
}: OrgQuickActionsProps) {
  const { mutate, loading } = useSuperadminMutation()

  // ── 1. Extender trial ────────────────────────────────────────────────────
  const [trialOpen, setTrialOpen] = useState(false)
  const [trialDias, setTrialDias] = useState("7")
  const [trialMotivo, setTrialMotivo] = useState("")

  const handleExtenderTrial = async () => {
    await mutate("/api/superadmin/trial-extension", {
      method: "POST",
      body: {
        organizationId: organization.id,
        dias: Number(trialDias),
        motivo: trialMotivo || undefined,
      },
      successMessage: "Trial extendido",
      onSuccess: () => {
        setTrialOpen(false)
        setTrialDias("7")
        setTrialMotivo("")
        onUpdated()
      },
    })
  }

  // ── 2. Cambiar plan ──────────────────────────────────────────────────────
  const [planOpen, setPlanOpen] = useState(false)
  const [planSlug, setPlanSlug] = useState("")
  const [billingPeriod, setBillingPeriod] = useState<"MONTHLY" | "YEARLY">("MONTHLY")
  const plansFetch = useSuperadminFetch<{ plans: PlanWithUsage[] }>()

  const openPlanDialog = () => {
    setPlanOpen(true)
    plansFetch.fetchData("/api/superadmin/plans")
  }

  const activePlans = (plansFetch.data?.plans ?? []).filter(
    (p) => p.activo && !p.deleted_at
  )

  const handleCambiarPlan = async () => {
    await mutate("/api/superadmin/subscriptions/renew", {
      method: "POST",
      body: { organizationId: organization.id, planSlug, billingPeriod },
      successMessage: "Plan actualizado",
      onSuccess: () => {
        setPlanOpen(false)
        setPlanSlug("")
        setBillingPeriod("MONTHLY")
        onUpdated()
      },
    })
  }

  // ── 3. Cancelar suscripción ──────────────────────────────────────────────
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelImmediate, setCancelImmediate] = useState(false)

  const handleCancelarSuscripcion = async () => {
    await mutate("/api/superadmin/subscriptions/cancel", {
      method: "POST",
      body: { organizationId: organization.id, immediate: cancelImmediate },
      successMessage: "Suscripción cancelada",
      onSuccess: () => {
        setCancelOpen(false)
        setCancelImmediate(false)
        onUpdated()
      },
    })
  }

  // ── 4. Suspender / Reactivar ─────────────────────────────────────────────
  const [toggleStatusOpen, setToggleStatusOpen] = useState(false)

  const handleToggleStatus = async () => {
    await mutate(
      `/api/superadmin/organizations/${organization.id}/toggle-status`,
      {
        method: "POST",
        body: { activo: !organization.activo },
        successMessage: organization.activo
          ? "Organización suspendida"
          : "Organización reactivada",
        onSuccess: () => {
          setToggleStatusOpen(false)
          onUpdated()
        },
      }
    )
  }

  // ── 5. Archivar ──────────────────────────────────────────────────────────
  const [archivarOpen, setArchivarOpen] = useState(false)
  const [archivarSlugInput, setArchivarSlugInput] = useState("")

  const handleArchivar = async () => {
    await mutate(`/api/superadmin/organizations/${organization.id}`, {
      method: "DELETE",
      successMessage: "Organización archivada",
      onSuccess: () => {
        setArchivarOpen(false)
        setArchivarSlugInput("")
        onUpdated()
      },
    })
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* Quick-actions bar */}
      <div className="flex flex-wrap gap-2">
        {/* 1. Extender trial — only when subscription exists */}
        {subscription !== null && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTrialOpen(true)}
          >
            <Calendar className="h-4 w-4 mr-1.5" />
            Extender trial
          </Button>
        )}

        {/* 2. Cambiar plan — always available */}
        <Button variant="outline" size="sm" onClick={openPlanDialog}>
          <CreditCard className="h-4 w-4 mr-1.5" />
          Cambiar plan
        </Button>

        {/* 3. Cancelar suscripción — only when sub exists and not already CANCELED */}
        {subscription && subscription.status !== "CANCELED" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCancelOpen(true)}
          >
            <XCircle className="h-4 w-4 mr-1.5" />
            Cancelar suscripción
          </Button>
        )}

        {/* 4. Suspender / Reactivar */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setToggleStatusOpen(true)}
        >
          {organization.activo ? (
            <>
              <PowerOff className="h-4 w-4 mr-1.5" />
              Suspender
            </>
          ) : (
            <>
              <Power className="h-4 w-4 mr-1.5" />
              Reactivar
            </>
          )}
        </Button>

        {/* 5. Archivar */}
        <Button
          variant="outline"
          size="sm"
          className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
          onClick={() => {
            setArchivarSlugInput("")
            setArchivarOpen(true)
          }}
        >
          <Trash2 className="h-4 w-4 mr-1.5" />
          Archivar
        </Button>
      </div>

      {/* ── Dialog 1: Extender trial ───────────────────────────────────────── */}
      <Dialog open={trialOpen} onOpenChange={setTrialOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Extender trial</DialogTitle>
            <DialogDescription>
              Añadir días de trial para{" "}
              <span className="font-medium">{organization.nombre}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="trial-dias">Días a extender</Label>
              <Input
                id="trial-dias"
                type="number"
                min={1}
                max={90}
                required
                value={trialDias}
                onChange={(e) => setTrialDias(e.target.value)}
                placeholder="7"
              />
              <p className="text-xs text-muted-foreground">Entre 1 y 90 días.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="trial-motivo">Motivo (opcional)</Label>
              <Input
                id="trial-motivo"
                value={trialMotivo}
                onChange={(e) => setTrialMotivo(e.target.value)}
                placeholder="Ej: solicitud del cliente"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTrialOpen(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleExtenderTrial}
              disabled={
                loading ||
                !trialDias ||
                Number(trialDias) < 1 ||
                Number(trialDias) > 90
              }
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Procesando...
                </>
              ) : (
                "Extender"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog 2: Cambiar plan ─────────────────────────────────────────── */}
      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cambiar plan</DialogTitle>
            <DialogDescription>
              Asignar un nuevo plan a{" "}
              <span className="font-medium">{organization.nombre}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Plan</Label>
              {plansFetch.loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cargando planes…
                </div>
              ) : (
                <Select value={planSlug} onValueChange={setPlanSlug}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar plan…" />
                  </SelectTrigger>
                  <SelectContent>
                    {activePlans.map((p) => (
                      <SelectItem key={p.slug} value={p.slug}>
                        {p.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Período de facturación</Label>
              <Select
                value={billingPeriod}
                onValueChange={(v) =>
                  setBillingPeriod(v as "MONTHLY" | "YEARLY")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTHLY">Mensual</SelectItem>
                  <SelectItem value="YEARLY">Anual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPlanOpen(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCambiarPlan}
              disabled={loading || !planSlug}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Procesando...
                </>
              ) : (
                "Confirmar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog 3: Cancelar suscripción (plain Dialog — needs checkbox body) ── */}
      {/* ConfirmDialog has no custom body slot, so we use a plain Dialog to
          include the "cancelar inmediatamente" checkbox safely. */}
      <Dialog
        open={cancelOpen}
        onOpenChange={(open) => {
          setCancelOpen(open)
          if (!open) setCancelImmediate(false)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-red-100">
                <XCircle className="h-6 w-6 text-red-500" />
              </div>
              <div>
                <DialogTitle>Cancelar suscripción</DialogTitle>
                <DialogDescription className="mt-1">
                  ¿Cancelar la suscripción de{" "}
                  <span className="font-medium">{organization.nombre}</span>?
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="flex items-center gap-3 py-2">
            <input
              id="cancel-immediate"
              type="checkbox"
              checked={cancelImmediate}
              onChange={(e) => setCancelImmediate(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-destructive"
            />
            <Label htmlFor="cancel-immediate">
              Cancelar inmediatamente (sin esperar al fin del período)
            </Label>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setCancelOpen(false)
                setCancelImmediate(false)
              }}
              disabled={loading}
            >
              Cerrar
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelarSuscripcion}
              disabled={loading}
            >
              {loading ? "Procesando..." : "Cancelar suscripción"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog 4: Suspender / Reactivar (ConfirmDialog warning/info) ──── */}
      <ConfirmDialog
        open={toggleStatusOpen}
        onOpenChange={setToggleStatusOpen}
        title={organization.activo ? "Suspender organización" : "Reactivar organización"}
        description={
          organization.activo
            ? `¿Suspender a ${organization.nombre}? Los usuarios no podrán acceder hasta que sea reactivada.`
            : `¿Reactivar a ${organization.nombre}? Los usuarios recuperarán el acceso.`
        }
        confirmText={organization.activo ? "Suspender" : "Reactivar"}
        variant={organization.activo ? "warning" : "info"}
        loading={loading}
        onConfirm={handleToggleStatus}
      />

      {/* ── Dialog 5: Archivar (plain Dialog con gate de slug) ─────────────── */}
      <Dialog
        open={archivarOpen}
        onOpenChange={(open) => {
          setArchivarOpen(open)
          if (!open) setArchivarSlugInput("")
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-red-100">
                <Trash2 className="h-6 w-6 text-red-500" />
              </div>
              <div>
                <DialogTitle>Archivar organización</DialogTitle>
                <DialogDescription className="mt-1">
                  Esta acción no se puede deshacer. Escribí el slug{" "}
                  <code className="bg-muted px-1 rounded text-xs font-mono">
                    {organization.slug}
                  </code>{" "}
                  para confirmar.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-1.5 py-2">
            <Label htmlFor="archivar-slug">Slug de la organización</Label>
            <Input
              id="archivar-slug"
              value={archivarSlugInput}
              onChange={(e) => setArchivarSlugInput(e.target.value)}
              placeholder={organization.slug}
              autoComplete="off"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setArchivarOpen(false)
                setArchivarSlugInput("")
              }}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleArchivar}
              disabled={loading || archivarSlugInput !== organization.slug}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Archivando...
                </>
              ) : (
                "Archivar organización"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
