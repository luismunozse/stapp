"use client"

import { useMemo, useRef, useState, type MouseEvent } from "react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { diagramaPorRef, type VistaId } from "@/components/ordenes/danos/diagramas"
import { SelectorTipoDano } from "@/components/ordenes/danos/selector-tipo-dano"
import type { PinVista } from "@/components/ordenes/danos/pin-vista"
import { TIPO_DANO_META, type DanoInput, type TipoDano } from "@/lib/ordenes/danos"
import { cn } from "@/lib/utils"

export type { PinVista }

interface Props {
  diagrama: string
  pins: PinVista[]
  editable: boolean
  onAgregar?: (p: Omit<DanoInput, "diagrama">) => void
  resaltado?: number | null
  onSeleccionar?: (numero: number) => void
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const redondear = (v: number) => Math.round(clamp01(v) * 10000) / 10000

export function DiagramaDanos({ diagrama, pins, editable, onAgregar, resaltado, onSeleccionar }: Props) {
  const def = useMemo(() => diagramaPorRef(diagrama), [diagrama])
  const [vistaId, setVistaId] = useState<VistaId>(def.vistas[0].id)
  const [pendiente, setPendiente] = useState<{ vista: VistaId; x: number; y: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const vista = def.vistas.find((v) => v.id === vistaId) ?? def.vistas[0]
  const [, , vbW, vbH] = vista.viewBox.split(/\s+/).map(Number)
  const pinsVista = pins.filter((p) => p.vista === vista.id)

  function onClickDibujo(e: MouseEvent<SVGSVGElement>) {
    if (!editable || !svgRef.current) return
    const r = svgRef.current.getBoundingClientRect()
    if (!r.width || !r.height) return
    setPendiente({
      vista: vista.id,
      x: redondear((e.clientX - r.left) / r.width),
      y: redondear((e.clientY - r.top) / r.height),
    })
  }

  function elegir(tipo: TipoDano, nota: string | null) {
    if (!pendiente) return
    onAgregar?.({ vista: pendiente.vista, x: pendiente.x, y: pendiente.y, tipo, nota })
    setPendiente(null)
  }

  return (
    <div className="space-y-3">
      {def.vistas.length > 1 && (
        <Tabs value={vista.id} onValueChange={(v) => setVistaId(v as VistaId)}>
          <TabsList className="h-11 w-full">
            {def.vistas.map((v) => (
              <TabsTrigger key={v.id} value={v.id} className="min-h-9 flex-1">
                {v.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <div
        className="relative mx-auto w-full max-w-xs rounded-lg border bg-muted/30 text-muted-foreground"
        style={{ aspectRatio: `${vbW} / ${vbH}` }}
      >
        <svg
          ref={svgRef}
          viewBox={vista.viewBox}
          role="img"
          aria-label={`Dibujo del equipo, vista ${vista.label.toLowerCase()}`}
          data-testid="diagrama-svg"
          onClick={onClickDibujo}
          className={cn("h-full w-full", editable && "cursor-crosshair")}
        >
          {vista.paths.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {/* Overlay HTML: los pins en los bordes quedan completos (sin recorte del SVG). */}
        <div className="pointer-events-none absolute inset-0">
          {pinsVista.map((p) => {
            const meta = TIPO_DANO_META[p.tipo]
            const activo = resaltado === p.numero
            return (
              <button
                key={p.numero}
                type="button"
                aria-label={`Daño ${p.numero}: ${meta.label.toLowerCase()}, ${vista.label.toLowerCase()}`}
                aria-pressed={activo}
                onClick={(e) => {
                  e.stopPropagation()
                  onSeleccionar?.(p.numero)
                }}
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                className="pointer-events-auto absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center focus-visible:outline-none"
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full border-2 bg-background text-xs font-bold shadow",
                    meta.colorClass,
                    "border-current",
                    activo && "scale-125 ring-2 ring-ring ring-offset-1 ring-offset-background",
                  )}
                >
                  {p.numero}
                </span>
              </button>
            )
          })}
          {pendiente && pendiente.vista === vista.id && (
            <span
              aria-hidden="true"
              style={{ left: `${pendiente.x * 100}%`, top: `${pendiente.y * 100}%` }}
              className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-primary bg-primary/20"
            />
          )}
        </div>
      </div>

      {editable && (
        <p className="text-center text-xs text-muted-foreground">Tocá el dibujo donde esté el daño.</p>
      )}

      <SelectorTipoDano open={pendiente !== null} onElegir={elegir} onCerrar={() => setPendiente(null)} />
    </div>
  )
}
