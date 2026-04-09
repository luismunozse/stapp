"use client"

import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Package, DollarSign, TrendingUp, AlertCircle, AlertTriangle, Wallet } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

interface InventarioStatsData {
  totalSkus: number
  valorCosto: number
  valorVenta: number
  sinStock: number
  bajoStock: number
  valorEnRiesgo: number
}

interface InventarioStatsProps {
  // Permite que el padre reciba clicks en cada card y aplique filtros
  onFilterSinStock?: () => void
  onFilterBajoStock?: () => void
  // Trigger de refresh cuando cambia el inventario (mismo refreshKey de la lista)
  refreshKey?: number
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function InventarioStats({ onFilterSinStock, onFilterBajoStock, refreshKey = 0 }: InventarioStatsProps) {
  const { formatPrice } = useCurrency()
  const { data, isLoading } = useSWR<InventarioStatsData>(
    `/api/inventario/stats?_r=${refreshKey}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  const cards = [
    {
      title: "SKUs activos",
      value: isLoading ? "—" : data?.totalSkus.toLocaleString() ?? "0",
      icon: Package,
      bgClass: "bg-blue-100 dark:bg-blue-950",
      colorClass: "text-blue-600 dark:text-blue-400",
      description: "Items en catálogo",
      onClick: undefined,
    },
    {
      title: "Valor a costo",
      value: isLoading ? "—" : formatPrice(data?.valorCosto ?? 0),
      icon: DollarSign,
      bgClass: "bg-emerald-100 dark:bg-emerald-950",
      colorClass: "text-emerald-600 dark:text-emerald-400",
      description: "Inversión inmovilizada",
      onClick: undefined,
    },
    {
      title: "Valor a venta",
      value: isLoading ? "—" : formatPrice(data?.valorVenta ?? 0),
      icon: TrendingUp,
      bgClass: "bg-violet-100 dark:bg-violet-950",
      colorClass: "text-violet-600 dark:text-violet-400",
      description: "Potencial de venta",
      onClick: undefined,
    },
    {
      title: "Sin stock",
      value: isLoading ? "—" : (data?.sinStock ?? 0).toString(),
      icon: AlertCircle,
      bgClass: "bg-red-100 dark:bg-red-950",
      colorClass: "text-red-600 dark:text-red-400",
      description: "Items en cero",
      onClick: onFilterSinStock,
    },
    {
      title: "Bajo stock",
      value: isLoading ? "—" : (data?.bajoStock ?? 0).toString(),
      icon: AlertTriangle,
      bgClass: "bg-amber-100 dark:bg-amber-950",
      colorClass: "text-amber-600 dark:text-amber-400",
      description: "Bajo del mínimo",
      onClick: onFilterBajoStock,
    },
    {
      title: "Valor en riesgo",
      value: isLoading ? "—" : formatPrice(data?.valorEnRiesgo ?? 0),
      icon: Wallet,
      bgClass: "bg-orange-100 dark:bg-orange-950",
      colorClass: "text-orange-600 dark:text-orange-400",
      description: "Costo de reposición",
      onClick: undefined,
    },
  ]

  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((card) => {
        const Icon = card.icon
        const clickable = !!card.onClick
        return (
          <Card
            key={card.title}
            className={`transition-shadow hover:shadow-md ${clickable ? "cursor-pointer hover:border-primary/50" : ""}`}
            onClick={card.onClick}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <div className={`p-1.5 rounded-lg ${card.bgClass}`}>
                <Icon className={`h-3.5 w-3.5 ${card.colorClass}`} />
              </div>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <div className="text-base sm:text-lg font-bold text-foreground truncate">
                {card.value}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {card.description}
              </p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
