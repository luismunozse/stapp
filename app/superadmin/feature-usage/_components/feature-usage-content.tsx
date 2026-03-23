"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Puzzle,
  RefreshCw,
  Loader2,
  Search,
  ArrowUpDown,
  CheckCircle2,
  XCircle,
  TrendingUp,
  AlertTriangle,
  Zap,
} from "lucide-react"
import { useSuperadminFetch } from "@/hooks/use-superadmin-fetch"
import { cn } from "@/lib/utils"

interface FeatureAdoption {
  feature: string
  label: string
  usingCount: number
  totalOrgs: number
  percentage: number
}

interface OrgUsage {
  id: string
  nombre: string
  slug: string
  adoptionScore: number
  featuresActivas: number
  totalFeatures: number
  ordenes: number
  ventas: number
  clientes: number
  tecnicos: number
  fecha: string
  features: Record<string, boolean>
}

interface FeatureUsageData {
  summary: {
    totalOrgs: number
    avgAdoption: number
    lowAdoption: number
    highAdoption: number
  }
  featureAdoption: FeatureAdoption[]
  organizations: OrgUsage[]
  featureLabels: Record<string, string>
}

const adoptionColor = (score: number) => {
  if (score >= 70) return "text-green-600"
  if (score >= 30) return "text-amber-600"
  return "text-red-600"
}

const adoptionBg = (score: number) => {
  if (score >= 70) return "bg-green-500"
  if (score >= 30) return "bg-amber-500"
  return "bg-red-500"
}

export function FeatureUsageContent() {
  const { data, loading, fetchData } = useSuperadminFetch<FeatureUsageData>({ showErrorToast: true })
  const [search, setSearch] = useState("")
  const [sortBy, setSortBy] = useState<"adoption" | "ordenes" | "nombre">("adoption")
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    await fetchData("/api/superadmin/stats/feature-usage")
  }, [fetchData])

  useEffect(() => {
    loadData()
  }, [loadData])

  const filteredOrgs = (data?.organizations || [])
    .filter(o => !search || o.nombre.toLowerCase().includes(search.toLowerCase()) || o.slug.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "adoption") return a.adoptionScore - b.adoptionScore
      if (sortBy === "ordenes") return b.ordenes - a.ordenes
      return a.nombre.localeCompare(b.nombre)
    })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Feature Usage</h1>
          <p className="text-muted-foreground">Adopcion de funcionalidades por organizacion</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Actualizar
        </Button>
      </div>

      {/* Summary Cards */}
      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2"><div className="h-4 w-20 bg-muted rounded" /></CardHeader>
              <CardContent><div className="h-7 w-12 bg-muted rounded" /></CardContent>
            </Card>
          ))}
        </div>
      ) : data ? (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Orgs analizadas</CardTitle>
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-950"><Puzzle className="h-4 w-4 text-blue-600" /></div>
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{data.summary.totalOrgs}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Adopcion Promedio</CardTitle>
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-950"><TrendingUp className="h-4 w-4 text-green-600" /></div>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${adoptionColor(data.summary.avgAdoption)}`}>
                {data.summary.avgAdoption}%
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Alta adopcion</CardTitle>
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950"><Zap className="h-4 w-4 text-emerald-600" /></div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">{data.summary.highAdoption}</div>
              <p className="text-xs text-muted-foreground">70%+ features</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Baja adopcion</CardTitle>
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-950"><AlertTriangle className="h-4 w-4 text-red-600" /></div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{data.summary.lowAdoption}</div>
              <p className="text-xs text-muted-foreground">&lt;30% features</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Feature Adoption Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Puzzle className="h-5 w-5" />
              Adopcion por Feature
            </CardTitle>
            <CardDescription>% de orgs que usan cada funcionalidad</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(data?.featureAdoption || []).map(f => (
                <div key={f.feature}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm">{f.label}</span>
                    <span className={cn("text-sm font-medium", adoptionColor(f.percentage))}>
                      {f.percentage}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", adoptionBg(f.percentage))}
                      style={{ width: `${f.percentage}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {f.usingCount} de {f.totalOrgs} orgs
                  </p>
                </div>
              ))}
              {(!data || data.featureAdoption.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Sin datos. El tracking se ejecuta diariamente a las 3 AM.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Organizations Table */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Puzzle className="h-5 w-5" />
                Adopcion por Organizacion
              </CardTitle>
              <div className="flex gap-2 mt-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Buscar organizacion..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
                </div>
                <Button variant="outline" size="sm" onClick={() => setSortBy(s => s === "adoption" ? "ordenes" : s === "ordenes" ? "nombre" : "adoption")}>
                  <ArrowUpDown className="h-4 w-4 mr-1" />
                  {sortBy === "adoption" ? "Adopcion" : sortBy === "ordenes" ? "Ordenes" : "Nombre"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {filteredOrgs.map(org => (
                  <div key={org.id}>
                    <div
                      className="flex items-center justify-between py-3 px-3 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => setExpandedOrg(expandedOrg === org.id ? null : org.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate">{org.nombre}</p>
                          <Badge variant="outline" className="text-xs shrink-0">
                            {org.featuresActivas}/{org.totalFeatures}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{org.slug}.stapp.com.ar</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right hidden sm:block">
                          <p className="text-sm">{org.ordenes} ord</p>
                          <p className="text-xs text-muted-foreground">{org.clientes} clientes</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                            <div className={cn("h-full rounded-full", adoptionBg(org.adoptionScore))} style={{ width: `${org.adoptionScore}%` }} />
                          </div>
                          <span className={cn("text-sm font-bold w-10 text-right", adoptionColor(org.adoptionScore))}>
                            {org.adoptionScore}%
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Expanded: feature detail */}
                    {expandedOrg === org.id && (
                      <div className="ml-3 mr-3 mb-2 p-3 bg-muted/30 rounded-b-lg border border-t-0">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {Object.entries(data?.featureLabels || {}).map(([key, label]) => {
                            const active = org.features[key]
                            return (
                              <div key={key} className="flex items-center gap-1.5 text-sm">
                                {active ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                                ) : (
                                  <XCircle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                                )}
                                <span className={active ? "text-foreground" : "text-muted-foreground"}>
                                  {label}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                        <div className="flex gap-4 mt-3 pt-3 border-t text-xs text-muted-foreground">
                          <span>{org.tecnicos} tecnico{org.tecnicos !== 1 ? "s" : ""}</span>
                          <span>{org.ventas} ventas</span>
                          <span>Actualizado: {org.fecha}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {filteredOrgs.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">
                    {data?.organizations.length === 0
                      ? "Sin datos. El tracking se ejecuta diariamente a las 3 AM."
                      : "No hay organizaciones que coincidan"}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
