"use client"

import { Check, X, Minus } from "lucide-react"
import { m, LazyMotion, domAnimation } from "@/components/animations/motion"
import { cn } from "@/lib/utils"

const rows = [
  {
    feature: "Órdenes de trabajo",
    stapp: "Digitales con estados en tiempo real",
    excel: "Planilla manual",
    papel: "Anotaciones sueltas",
    stappLevel: "full",
    excelLevel: "partial",
    papelLevel: "none",
  },
  {
    feature: "Control de inventario",
    stapp: "Alertas automáticas de stock",
    excel: "Actualización manual",
    papel: "Imposible de controlar",
    stappLevel: "full",
    excelLevel: "partial",
    papelLevel: "none",
  },
  {
    feature: "Historial de clientes",
    stapp: "Completo y automático",
    excel: "Búsqueda lenta",
    papel: "Se pierde con el tiempo",
    stappLevel: "full",
    excelLevel: "partial",
    papelLevel: "none",
  },
  {
    feature: "Cobros y facturación",
    stapp: "Integrado con MercadoPago",
    excel: "Cálculos manuales",
    papel: "Sin registro confiable",
    stappLevel: "full",
    excelLevel: "partial",
    papelLevel: "none",
  },
  {
    feature: "Reportes",
    stapp: "Dashboards en tiempo real",
    excel: "Gráficos básicos",
    papel: "No existen",
    stappLevel: "full",
    excelLevel: "partial",
    papelLevel: "none",
  },
  {
    feature: "Acceso remoto",
    stapp: "Desde cualquier dispositivo",
    excel: "Solo en tu PC",
    papel: "Solo en el local",
    stappLevel: "full",
    excelLevel: "partial",
    papelLevel: "none",
  },
  {
    feature: "Fotos y firma digital",
    stapp: "Incluido",
    excel: "No disponible",
    papel: "No disponible",
    stappLevel: "full",
    excelLevel: "none",
    papelLevel: "none",
  },
  {
    feature: "Notificaciones WhatsApp",
    stapp: "Con un click",
    excel: "Manual",
    papel: "Manual",
    stappLevel: "full",
    excelLevel: "partial",
    papelLevel: "partial",
  },
] as const

function LevelIcon({ level }: { level: "full" | "partial" | "none" }) {
  if (level === "full") {
    return <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
  }
  if (level === "partial") {
    return <Minus className="w-4 h-4 text-yellow-500 flex-shrink-0" />
  }
  return <X className="w-4 h-4 text-red-500 flex-shrink-0" />
}

export function Comparison() {
  return (
    <LazyMotion features={domAnimation}>
      <section id="comparacion" className="py-12 sm:py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <m.div
            className="text-center max-w-3xl mx-auto mb-10"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Por qué cambiar a STApp
            </h2>
            <p className="text-lg text-muted-foreground">
              Compará cómo gestionás tu taller hoy vs cómo podrías hacerlo
            </p>
          </m.div>

          {/* Desktop table */}
          <m.div
            className="hidden md:block max-w-4xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.5 }}
          >
            <div className="rounded-xl border overflow-hidden bg-card shadow-sm">
              {/* Table header */}
              <div className="grid grid-cols-4 bg-muted/50 border-b">
                <div className="p-4 font-semibold text-sm text-foreground">
                  Funcionalidad
                </div>
                <div className="p-4 font-semibold text-sm text-primary text-center bg-primary/5 border-x border-primary/10">
                  STApp
                </div>
                <div className="p-4 font-semibold text-sm text-muted-foreground text-center">
                  Excel
                </div>
                <div className="p-4 font-semibold text-sm text-muted-foreground text-center">
                  Papel
                </div>
              </div>

              {/* Table rows */}
              {rows.map((row, index) => (
                <div
                  key={row.feature}
                  className={cn(
                    "grid grid-cols-4",
                    index < rows.length - 1 && "border-b"
                  )}
                >
                  <div className="p-4 text-sm font-medium text-foreground">
                    {row.feature}
                  </div>
                  <div className="p-4 text-sm text-center bg-primary/5 border-x border-primary/10">
                    <div className="flex items-center justify-center gap-2">
                      <LevelIcon level={row.stappLevel} />
                      <span className="text-foreground">{row.stapp}</span>
                    </div>
                  </div>
                  <div className="p-4 text-sm text-center">
                    <div className="flex items-center justify-center gap-2">
                      <LevelIcon level={row.excelLevel} />
                      <span className="text-muted-foreground">{row.excel}</span>
                    </div>
                  </div>
                  <div className="p-4 text-sm text-center">
                    <div className="flex items-center justify-center gap-2">
                      <LevelIcon level={row.papelLevel} />
                      <span className="text-muted-foreground">{row.papel}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </m.div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {rows.map((row, index) => (
              <m.div
                key={row.feature}
                className="rounded-xl border bg-card p-4 shadow-sm"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-30px" }}
                transition={{ duration: 0.4, delay: index * 0.05 }}
              >
                <h3 className="font-semibold text-sm text-foreground mb-3">
                  {row.feature}
                </h3>
                <div className="space-y-2">
                  <div className="flex items-start gap-2 bg-primary/5 rounded-lg px-3 py-2">
                    <LevelIcon level={row.stappLevel} />
                    <div>
                      <span className="text-xs font-medium text-primary">STApp</span>
                      <p className="text-sm text-foreground">{row.stapp}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 px-3 py-1.5">
                    <LevelIcon level={row.excelLevel} />
                    <div>
                      <span className="text-xs font-medium text-muted-foreground">Excel</span>
                      <p className="text-sm text-muted-foreground">{row.excel}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 px-3 py-1.5">
                    <LevelIcon level={row.papelLevel} />
                    <div>
                      <span className="text-xs font-medium text-muted-foreground">Papel</span>
                      <p className="text-sm text-muted-foreground">{row.papel}</p>
                    </div>
                  </div>
                </div>
              </m.div>
            ))}
          </div>
        </div>
      </section>
    </LazyMotion>
  )
}
