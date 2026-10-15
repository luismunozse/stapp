"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { etiquetaDeFila, filasEnOrden, type Fila, type VariantesState } from "@/lib/variantes-filas"
import { unidades } from "./campos-fila"

/*
 * "Which variant is this product?" When an existing product becomes the first combination of a new group
 * it keeps its id, code, price, stock and photos, so the user picks which new combination it takes and
 * sees what it holds in each depósito first.
 *
 * With no stock there is nothing worth asking: the dialog stays closed and the first new combination (or
 * the slot the product already holds) is confirmed straight away, once per opening. With no new
 * combination at all it confirms with `undefined`, so the reducer's own message ("Primero agregá las
 * opciones...") is what the user reads.
 */

export interface ItemParaPromover {
  id: string
  nombre?: string
  /** Units the product holds in total. */
  stock: number
}

interface Props {
  open: boolean
  item: ItemParaPromover
  estado: VariantesState
  /** The row the product takes (`promover { item, filaId }`), or undefined when there is none to take. */
  alConfirmar: (filaId: string | undefined) => void
  alCancelar: () => void
}

interface Deposito {
  id: string
  nombre: string
  stock: number
}

type Desglose = { tipo: "cargando" } | { tipo: "listo"; depositos: Deposito[] } | { tipo: "error" }

/** The depósitos with units; null when the answer is not what the route promises. */
function leerDepositos(cuerpo: unknown): Deposito[] | null {
  const data = (cuerpo as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return null
  return data
    .filter((d): d is { depositoId: string; depositoNombre: string; stock: number } => typeof d?.depositoId === "string" && typeof d?.stock === "number")
    .filter((d) => d.stock > 0)
    .map((d) => ({ id: d.depositoId, nombre: d.depositoNombre, stock: d.stock }))
}

function useDesglose(itemId: string, activo: boolean): Desglose {
  const [respuesta, setRespuesta] = useState<{ itemId: string; desglose: Desglose } | null>(null)
  useEffect(() => {
    if (!activo) return
    const control = new AbortController()
    fetch(`/api/inventario/${itemId}/depositos`, { signal: control.signal })
      .then(async (res) => {
        const depositos = res.ok ? leerDepositos(await res.json()) : null
        setRespuesta({ itemId, desglose: depositos ? { tipo: "listo", depositos } : { tipo: "error" } })
      })
      .catch(() => {
        if (!control.signal.aborted) setRespuesta({ itemId, desglose: { tipo: "error" } })
      })
    return () => control.abort()
  }, [itemId, activo])
  // An answer about another item is not an answer: until the new one arrives, it is loading.
  return respuesta && respuesta.itemId === itemId ? respuesta.desglose : { tipo: "cargando" }
}

export function PromoverDialog({ open, item, estado, alConfirmar, alCancelar }: Props) {
  const candidatas = filasEnOrden(estado).filter((f) => !f.archivar && (!f.existente || f.id === estado.promocionId))
  // Where the product already sits comes first, else the first new combination.
  const porDefecto = candidatas.find((f) => f.id === estado.promocionId) ?? candidatas[0]

  const preguntar = open && item.stock > 0 && candidatas.length > 0

  // No question to ask: decide once per opening and per product (the product it decided for is remembered).
  const decididoPara = useRef<string | null>(null)
  useEffect(() => {
    if (!open || preguntar) {
      decididoPara.current = null
      return
    }
    if (decididoPara.current === item.id) return
    decididoPara.current = item.id
    alConfirmar(porDefecto?.id)
  })

  // The question has its own state (the choice, the depósitos): it is mounted per opening and per product,
  // so nothing from the last time can show up in this one.
  if (!preguntar) return null
  return <Pregunta key={item.id} item={item} estado={estado} candidatas={candidatas} porDefecto={porDefecto} alConfirmar={alConfirmar} alCancelar={alCancelar} />
}

function Pregunta({
  item,
  estado,
  candidatas,
  porDefecto,
  alConfirmar,
  alCancelar,
}: Pick<Props, "item" | "estado" | "alConfirmar" | "alCancelar"> & { candidatas: Fila[]; porDefecto: Fila | undefined }) {
  const [elegida, setElegida] = useState<string | null>(null)
  const seleccion = candidatas.find((f) => f.id === elegida) ?? porDefecto
  const desglose = useDesglose(item.id, true)
  const sinDetalle = desglose.tipo === "listo" && desglose.depositos.length === 0

  return (
    <ResponsiveDialog open onOpenChange={(abierto) => !abierto && alCancelar()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>¿Qué variante es este producto?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {item.nombre ? `"${item.nombre}"` : "Este producto"} pasa a ser una de las variantes y conserva su código, su precio, su stock y sus fotos.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-2 text-sm">
          <p className="font-medium">Stock que tiene hoy</p>
          {desglose.tipo === "cargando" && <p className="text-muted-foreground">Cargando el stock por depósito…</p>}
          {desglose.tipo === "error" && (
            <p className="text-muted-foreground">
              No pudimos ver el stock por depósito. En total tiene {unidades(item.stock)}.
            </p>
          )}
          {sinDetalle && <p className="text-muted-foreground">En total tiene {unidades(item.stock)}, sin detalle por depósito.</p>}
          {desglose.tipo === "listo" && !sinDetalle && (
            <ul className="divide-y rounded-md border">
              {desglose.depositos.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>{d.nombre}</span>
                  <span className="tabular-nums text-muted-foreground">{unidades(d.stock)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div role="radiogroup" aria-label="Combinación" className="space-y-1">
          <p className="text-sm font-medium">Combinación</p>
          {candidatas.map((fila) => (
            <label key={fila.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input type="radio" name="combinacion-del-producto" checked={seleccion?.id === fila.id} onChange={() => setElegida(fila.id)} />
              {etiquetaDeFila(estado, fila)}
            </label>
          ))}
        </div>

        <ResponsiveDialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={alCancelar}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => alConfirmar(seleccion?.id)}>
            Usar esta combinación
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
