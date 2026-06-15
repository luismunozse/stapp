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
  Eye,
} from "lucide-react"
import { toast } from "sonner"
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
import { Textarea } from "@/components/ui/textarea"
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

  const resetTrialDialog = () => {
    setTrialOpen(false)
    setTrialDias("7")
    setTrialMotivo("")
  }

  const handleExtenderTrial = async () => {
    await mutate("/api/superadmin/trial-extension", {
      method: "POST",
      body: {
        organizationId: organization.id,
        dias: Number(trialDias),
        motivo: trialMotivo || undefined,
      },
      successMessage: "Trial actualizado",
      onSuccess: () => {
        resetTrialDialog()
        onUpdated()
      },
    })
  }

  const handleQuitarTrial = async () => {
    await mutate("/api/superadmin/trial-extension", {
      method: "POST",
      body: {
        organizationId: organization.id,
        remove: true,
        motivo: trialMotivo || undefined,
      },
      successMessage: "Trial finalizado",
      onSuccess: () => {
        resetTrialDialog()
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
  const [suspendReason, setSuspendReason] = useState("")

  const handleToggleStatus = async () => {
    const nextActivo = !organization.activo
    await mutate(
      `/api/superadmin/organizations/${organization.id}/toggle-status`,
      {
        method: "POST",
        // El motivo solo aplica al suspender; el backend lo exige en ese caso.
        body: nextActivo
          ? { activo: true }
          : { activo: false, reason: suspendReason.trim() },
        successMessage: organization.activo
          ? "Organización suspendida"
          : "Organización reactivada",
        onSuccess: () => {
          setToggleStatusOpen(false)
          setSuspendReason("")
          onUpdated()
        },
      }
    )
  }

  // ── 4b. Impersonar (solo lectura) ────────────────────────────────────────
  const [impersonarOpen, setImpersonarOpen] = useState(false)
  const [impersonarLoading, setImpersonarLoading] = useState(false)

  const handleImpersonar = async () => {
    setImpersonarLoading(true)
    try {
      const res = await fetch("/api/superadmin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: organization.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.url) {
        window.location.href = data.url
        return
      }
      toast.error(data?.error || "No se pudo iniciar la impersonación")
    } catch {
      toast.error("No se pudo iniciar la impersonación")
    } finally {
      setImpersonarLoading(false)
    }
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
            Ajustar trial
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

        {/* 4b. Impersonar (solo lectura) — only for active orgs */}
        {organization.activo && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImpersonarOpen(true)}
          >
            <Eye className="h-4 w-4 mr-1.5" />
            Impersonar
          </Button>
        )}

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
            <DialogTitle>Ajustar trial</DialogTitle>
            <DialogDescription>
              Extender, acortar o quitar el trial de{" "}
              <span className="font-medium">{organization.nombre}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="trial-dias">Días (negativo para acortar)</Label>
              <Input
                id="trial-dias"
                type="number"
                min={-90}
                max={90}
                required
                value={trialDias}
                onChange={(e) => setTrialDias(e.target.value)}
                placeholder="7"
              />
              <p className="text-xs text-muted-foreground">
                Entre -90 y 90 días. Tope acumulado de extensión: 90 días.
              </p>
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

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="destructive"
              className="sm:mr-auto"
              onClick={handleQuitarTrial}
              disabled={loading}
            >
              Quitar trial
            </Button>
            <Button
              variant="outline"
              onClick={resetTrialDialog}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleExtenderTrial}
              disabled={
                loading ||
                !trialDias ||
                Number.isNaN(Number(trialDias)) ||
                Number(trialDias) === 0 ||
                Number(trialDias) < -90 ||
                Number(trialDias) > 90
              }
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Procesando...
                </>
              ) : (
                "Aplicar"
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

            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              Al confirmar se <strong>activa</strong> el plan (estado ACTIVO), se
              finaliza cualquier trial en curso y se registra un{" "}
              <strong>pago MANUAL</strong> para el período elegido.
            </p>
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

      {/* ── Dialog 4: Reactivar (ConfirmDialog) — solo cuando está suspendida ── */}
      {!organization.activo && (
        <ConfirmDialog
          open={toggleStatusOpen}
          onOpenChange={setToggleStatusOpen}
          title="Reactivar organización"
          description={`¿Reactivar a ${organization.nombre}? Los usuarios recuperarán el acceso y se limpiará el motivo de suspensión.`}
          confirmText="Reactivar"
          variant="info"
          loading={loading}
          onConfirm={handleToggleStatus}
        />
      )}

      {/* ── Dialog 4: Suspender (plain Dialog con motivo obligatorio) ──────── */}
      {organization.activo && (
        <Dialog
          open={toggleStatusOpen}
          onOpenChange={(open) => {
            setToggleStatusOpen(open)
            if (!open) setSuspendReason("")
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Suspender organización</DialogTitle>
              <DialogDescription>
                Los usuarios de{" "}
                <span className="font-medium">{organization.nombre}</span> no
                podrán acceder hasta que sea reactivada. El motivo queda
                registrado en el audit log.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5 py-2">
              <Label htmlFor="suspend-reason">Motivo de la suspensión</Label>
              <Textarea
                id="suspend-reason"
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="Ej: falta de pago, uso indebido, solicitud del cliente…"
                rows={3}
                maxLength={500}
              />
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setToggleStatusOpen(false)
                  setSuspendReason("")
                }}
                disabled={loading}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={handleToggleStatus}
                disabled={loading || !suspendReason.trim()}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Suspendiendo...
                  </>
                ) : (
                  "Suspender"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Dialog 4b: Impersonar (ConfirmDialog) ──────────────────────────── */}
      <ConfirmDialog
        open={impersonarOpen}
        onOpenChange={setImpersonarOpen}
        title="Impersonar organización"
        description={`Vas a entrar a ${organization.nombre} en modo SOLO LECTURA. Verás lo que ve el cliente, pero no podrás modificar nada. El acceso queda registrado en el audit log. Tu sesión de admin se restaura al salir.`}
        confirmText="Impersonar"
        variant="info"
        loading={impersonarLoading}
        onConfirm={handleImpersonar}
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
