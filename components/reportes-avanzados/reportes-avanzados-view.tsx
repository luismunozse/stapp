"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Crown, TrendingUp, Users, Package, BarChart3 } from "lucide-react"
import { ComparativaIngresos } from "./comparativa-ingresos"
import { PerformanceTecnicos } from "./performance-tecnicos"
import { TopClientes } from "./top-clientes"
import { AnalisisInventario } from "./analisis-inventario"

export function ReportesAvanzadosView() {
  const [activeTab, setActiveTab] = useState("ingresos")

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
          <Crown className="h-6 w-6 text-yellow-600 dark:text-yellow-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Reportes Avanzados</h1>
          <p className="text-muted-foreground">
            Analiza el rendimiento de tu taller con métricas detalladas
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4">
          <TabsTrigger value="ingresos" className="gap-2">
            <TrendingUp className="h-4 w-4" />
            <span className="hidden sm:inline">Ingresos</span>
          </TabsTrigger>
          <TabsTrigger value="tecnicos" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Técnicos</span>
          </TabsTrigger>
          <TabsTrigger value="clientes" className="gap-2">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Clientes</span>
          </TabsTrigger>
          <TabsTrigger value="inventario" className="gap-2">
            <Package className="h-4 w-4" />
            <span className="hidden sm:inline">Inventario</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ingresos" className="mt-6">
          <ComparativaIngresos />
        </TabsContent>

        <TabsContent value="tecnicos" className="mt-6">
          <PerformanceTecnicos />
        </TabsContent>

        <TabsContent value="clientes" className="mt-6">
          <TopClientes />
        </TabsContent>

        <TabsContent value="inventario" className="mt-6">
          <AnalisisInventario />
        </TabsContent>
      </Tabs>
    </div>
  )
}
