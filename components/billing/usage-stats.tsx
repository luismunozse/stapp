"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { ClipboardList, Users, UserCog, HardDrive } from "lucide-react"
import type { UsageInfo, SubscriptionInfo } from "@/lib/subscriptions"

interface UsageStatsProps {
  usage: UsageInfo
  limits: SubscriptionInfo["limits"]
  planType: "FREE" | "PREMIUM"
}

export function UsageStats({ usage, limits, planType }: UsageStatsProps) {
  const stats = [
    {
      name: "Órdenes este mes",
      current: usage.ordenesMesActual,
      limit: limits.ordenes,
      icon: ClipboardList,
      color: "text-blue-500",
    },
    {
      name: "Técnicos",
      current: usage.tecnicos,
      limit: limits.tecnicos,
      icon: UserCog,
      color: "text-green-500",
    },
    {
      name: "Clientes",
      current: usage.clientes,
      limit: limits.clientes,
      icon: Users,
      color: "text-purple-500",
    },
    {
      name: "Almacenamiento",
      current: usage.storageMb,
      limit: limits.storageMb,
      icon: HardDrive,
      color: "text-orange-500",
      format: (value: number) => `${value.toFixed(1)} MB`,
    },
  ]

  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="text-base sm:text-lg">Uso del Plan</CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          {planType === "FREE"
            ? "Recursos de tu plan Free"
            : "Recursos utilizados (sin límites)"}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 pt-0">
        <div className="space-y-4 sm:space-y-6">
          {stats.map((stat) => {
            const percentage =
              stat.limit !== null
                ? Math.min(100, Math.round((stat.current / stat.limit) * 100))
                : null
            const isNearLimit = percentage !== null && percentage >= 80
            const isAtLimit = percentage !== null && percentage >= 100
            const format = stat.format || ((v: number) => v.toString())

            return (
              <div key={stat.name} className="space-y-1.5 sm:space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <stat.icon className={`h-4 w-4 shrink-0 ${stat.color}`} />
                    <span className="text-xs sm:text-sm font-medium truncate">{stat.name}</span>
                  </div>
                  <span className="text-xs sm:text-sm text-muted-foreground shrink-0">
                    {format(stat.current)}
                    {stat.limit !== null && ` / ${format(stat.limit)}`}
                    {stat.limit === null && " (ilimitado)"}
                  </span>
                </div>
                {percentage !== null && (
                  <Progress
                    value={percentage}
                    className={
                      isAtLimit
                        ? "bg-red-100 dark:bg-red-950/50 [&>div]:bg-red-500"
                        : isNearLimit
                        ? "bg-yellow-100 dark:bg-yellow-950/50 [&>div]:bg-yellow-500"
                        : ""
                    }
                  />
                )}
                {isAtLimit && (
                  <p className="text-[10px] sm:text-xs text-red-600">
                    Has alcanzado el límite
                  </p>
                )}
                {isNearLimit && !isAtLimit && (
                  <p className="text-[10px] sm:text-xs text-yellow-600">
                    Cerca del límite
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
