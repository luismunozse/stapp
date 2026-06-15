"use client"

import { useEffect, useCallback } from "react"
import { Flag, RotateCcw } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  useSuperadminFetch,
  useSuperadminMutation,
} from "@/hooks/use-superadmin-fetch"
import type { OrganizationDetail } from "@/types/superadmin"

interface FeatureOverride {
  feature_key: string
  enabled: boolean
}

interface FeatureOverridesResponse {
  overrides: FeatureOverride[]
  featureKeys: string[]
  planFlags: Record<string, boolean>
}

interface OrgFeatureFlagsSectionProps {
  organization: OrganizationDetail
}

/**
 * Per-org feature-flag overrides. Each feature shows its EFFECTIVE state
 * (override if present, otherwise the plan default). Toggling writes an
 * override; "Restablecer" removes it so the feature falls back to the plan.
 */
export function OrgFeatureFlagsSection({
  organization,
}: OrgFeatureFlagsSectionProps) {
  const { data, loading, fetchData } =
    useSuperadminFetch<FeatureOverridesResponse>()
  const { mutate, loading: mutating } = useSuperadminMutation()

  const endpoint = `/api/superadmin/organizations/${organization.id}/feature-overrides`

  const refresh = useCallback(() => {
    fetchData(endpoint)
  }, [endpoint, fetchData])

  useEffect(() => {
    refresh()
  }, [refresh])

  const overridesMap = new Map(
    (data?.overrides ?? []).map((o) => [o.feature_key, o.enabled])
  )
  const planFlags = data?.planFlags ?? {}
  const featureKeys = data?.featureKeys ?? []

  const setOverride = (featureKey: string, enabled: boolean) =>
    mutate(endpoint, {
      method: "POST",
      body: { featureKey, enabled },
      successMessage: "Feature actualizada",
      onSuccess: refresh,
    })

  const clearOverride = (featureKey: string) =>
    mutate(endpoint, {
      method: "DELETE",
      body: { featureKey },
      successMessage: "Override eliminado",
      onSuccess: refresh,
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Flag className="h-5 w-5" />
          Feature flags por organización
        </CardTitle>
        <CardDescription>
          Habilitá o deshabilitá features para{" "}
          <span className="font-medium">{organization.nombre}</span>,
          independientemente del plan. Un override prevalece sobre el plan.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {loading && featureKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">Cargando…</p>
        ) : featureKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            El plan no define features configurables.
          </p>
        ) : (
          <div className="space-y-3">
            {featureKeys.map((key) => {
              const hasOverride = overridesMap.has(key)
              const effective = hasOverride
                ? (overridesMap.get(key) as boolean)
                : planFlags[key] === true

              return (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 border-b border-border/50 pb-3 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{key}</span>
                      {hasOverride && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200 leading-none">
                          override
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {hasOverride
                        ? `Override: ${effective ? "habilitada" : "deshabilitada"}`
                        : `Según el plan: ${planFlags[key] === true ? "habilitada" : "deshabilitada"}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {hasOverride && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                        onClick={() => clearOverride(key)}
                        disabled={mutating}
                        title="Restablecer al valor del plan"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    )}
                    <Switch
                      checked={effective}
                      disabled={mutating}
                      onCheckedChange={(checked) => setOverride(key, checked)}
                      aria-label={`Toggle ${key}`}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
