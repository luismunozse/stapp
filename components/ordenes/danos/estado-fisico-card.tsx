"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DiagramaDanos, type PinVista } from "@/components/ordenes/danos/diagrama-danos"
import { ListaDanos } from "@/components/ordenes/danos/lista-danos"
import { VENTANA_BORRADO_DIAGNOSTICO_MS, type DanoInput, type DanoOrden } from "@/lib/ordenes/danos"

interface Props {
  ordenId: string
  puedeAgregar: boolean
}

interface RespuestaDanos {
  danos: DanoOrden[]
  sinDanos: boolean
  diagrama: string
}

async function mensajeDeError(res: Response, porDefecto: string) {
  try {
    const data = await res.json()
    return typeof data?.error === "string" && data.error ? data.error : porDefecto
  } catch {
    return porDefecto
  }
}

export function EstadoFisicoCard({ ordenId, puedeAgregar }: Props) {
  const [datos, setDatos] = useState<RespuestaDanos | null>(null)
  const [error, setError] = useState(false)
  const [agregando, setAgregando] = useState(false)
  const [resaltado, setResaltado] = useState<number | null>(null)
  const base = `/api/ordenes/${ordenId}/danos`

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(base)
      if (!res.ok) throw new Error()
      const json = (await res.json()) as Partial<RespuestaDanos>
      if (!Array.isArray(json.danos) || typeof json.diagrama !== "string") throw new Error()
      setDatos({ danos: json.danos, sinDanos: json.sinDanos === true, diagrama: json.diagrama })
      setError(false)
    } catch {
      setError(true)
    }
  }, [base])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function agregar(p: Omit<DanoInput, "diagrama">) {
    if (!datos) return
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...p, diagrama: datos.diagrama }),
      })
      if (!res.ok) {
        toast.error(await mensajeDeError(res, "No se pudo agregar el daño"))
        return
      }
      await cargar()
    } catch {
      toast.error("No se pudo agregar el daño")
    }
  }

  async function borrar(id: string) {
    try {
      const res = await fetch(`${base}/${id}`, { method: "DELETE" })
      if (!res.ok) {
        toast.error(await mensajeDeError(res, "No se pudo borrar el daño"))
        return
      }
      await cargar()
    } catch {
      toast.error("No se pudo borrar el daño")
    }
  }

  if (error && !datos) return null
  if (!datos) return <Skeleton className="h-32 w-full rounded-xl" />

  const pins: PinVista[] = datos.danos
  const deRecepcion = pins.filter((p) => p.momento === "recepcion")
  const deDiagnostico = pins.filter((p) => p.momento === "diagnostico")
  const puedeBorrar = (p: PinVista) =>
    p.momento === "diagnostico" &&
    !!p.createdAt &&
    Date.now() - new Date(p.createdAt).getTime() < VENTANA_BORRADO_DIAGNOSTICO_MS
  const sinRegistro = pins.length === 0 && !datos.sinDanos

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          Estado físico
        </h2>

        {datos.sinDanos && <p className="text-sm text-muted-foreground">Sin daños visibles al ingreso</p>}
        {sinRegistro && (
          <p className="text-sm text-muted-foreground">No se registró el estado físico al recibir el equipo</p>
        )}

        {(pins.length > 0 || agregando) && (
          <DiagramaDanos
            diagrama={datos.diagrama}
            pins={pins}
            editable={agregando}
            onAgregar={agregar}
            resaltado={resaltado}
            onSeleccionar={setResaltado}
          />
        )}

        {deRecepcion.length > 0 && (
          <section className="space-y-1.5">
            <h3 className="text-sm font-medium">Al recibir</h3>
            <ListaDanos pins={deRecepcion} resaltado={resaltado} onSeleccionar={setResaltado} />
          </section>
        )}
        {deDiagnostico.length > 0 && (
          <section className="space-y-1.5">
            <h3 className="text-sm font-medium">Detectados en diagnóstico</h3>
            <ListaDanos
              pins={deDiagnostico}
              mostrarAutor
              onBorrar={borrar}
              puedeBorrar={puedeBorrar}
              resaltado={resaltado}
              onSeleccionar={setResaltado}
            />
          </section>
        )}

        {puedeAgregar &&
          (agregando ? (
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setAgregando(false)}>
              Listo
            </Button>
          ) : (
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setAgregando(true)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Agregar daño detectado
            </Button>
          ))}
      </CardContent>
    </Card>
  )
}
