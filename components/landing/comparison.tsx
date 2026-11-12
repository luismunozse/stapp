import { Check, Minus } from "lucide-react"
import type { AllPlansPrices } from "@/lib/pricing"
import { buildPlanComparison, type ComparisonRow, type ComparisonValue } from "@/lib/plan-copy"
import { cn } from "@/lib/utils"

// Tabla de planes de /precios. Server component sin animaciones: cada celda
// sale de la tabla `plans` (límites + feature_flags) vía buildPlanComparison,
// la misma fuente que las cards y el FAQ.

function Cell({ value }: { value: ComparisonValue }) {
  if (value === true) {
    return (
      <>
        <Check className="mx-auto h-4 w-4 text-success-600" aria-hidden="true" />
        <span className="sr-only">Incluido</span>
      </>
    )
  }
  if (value === false) {
    return (
      <>
        <Minus className="mx-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">No incluido</span>
      </>
    )
  }
  return <span className="font-medium text-foreground">{value}</span>
}

function RowGroup({
  title,
  rows,
  highlightIndex,
}: {
  title: string
  rows: ComparisonRow[]
  highlightIndex: number
}) {
  return (
    <tbody>
      <tr className="border-b bg-muted/40">
        <th
          scope="colgroup"
          colSpan={rows[0]?.values.length ? rows[0].values.length + 1 : 1}
          className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4"
        >
          {title}
        </th>
      </tr>
      {rows.map((row) => (
        <tr key={row.label} className="border-b last:border-b-0">
          <th scope="row" className="px-3 py-3 text-left font-normal text-foreground sm:px-4">
            {row.label}
          </th>
          {row.values.map((value, i) => (
            <td
              key={i}
              className={cn(
                "px-3 py-3 text-center sm:px-4",
                i === highlightIndex && "bg-primary/5"
              )}
            >
              <Cell value={value} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

export function PlanComparison({ allPlans }: { allPlans: AllPlansPrices }) {
  const { plans, limitRows, featureRows } = buildPlanComparison(allPlans)
  const highlightIndex = plans.findIndex((p) => p.slug === "profesional")

  return (
    <section id="comparacion" className="scroll-mt-24 py-10 sm:py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-8 max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-balance text-foreground sm:text-4xl">
            Qué incluye cada plan
          </h2>
          <p className="mt-3 text-lg text-muted-foreground">
            Los mismos límites que aplica la app, sin letra chica.
          </p>
        </div>

        <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border bg-card shadow-sm">
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">Comparación de planes de STApp</caption>
            <colgroup>
              <col className="w-1/2" />
              {plans.map((p) => (
                <col key={p.slug} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b">
                <th scope="col" className="px-3 py-3 text-left font-semibold text-foreground sm:px-4">
                  <span className="sr-only">Función</span>
                </th>
                {plans.map((p, i) => (
                  <th
                    key={p.slug}
                    scope="col"
                    className={cn(
                      "px-3 py-3 text-center font-semibold sm:px-4",
                      i === highlightIndex ? "bg-primary/5 text-primary" : "text-foreground"
                    )}
                  >
                    {p.nombre}
                  </th>
                ))}
              </tr>
            </thead>
            <RowGroup title="Límites" rows={limitRows} highlightIndex={highlightIndex} />
            <RowGroup title="Funciones" rows={featureRows} highlightIndex={highlightIndex} />
          </table>
        </div>
      </div>
    </section>
  )
}
