"use client"

import { useRef, useState, type ChangeEvent } from "react"
import { ImagePlus, Loader2 } from "lucide-react"
import { etiquetaDeFila, type Fila, type VariantesState } from "@/lib/variantes-filas"
import { respaldoDeFila } from "./vista"
import type { FotosVariantes, ResultadoDeElegir, VistaFoto } from "./use-fotos-variantes"

/*
 * The photo slot of one combination. Presentational: it shows what the photo hook knows (`vista`) and
 * calls back with the row id. A variant without its own photo shows a sibling's, dimmed and captioned,
 * and offers to add its own; that borrowed photo can never be removed from here because it is not the
 * row's. The slot is 40px in the table and 56px in a card; secondary controls keep a 44px target on the card.
 */

export interface PropsFotoVariante {
  id: string
  /** The row's own photo, saved. */
  propia: string | null
  /** A sibling's photo shown while the row has none of its own. Display only. */
  respaldo: { url: string; etiqueta: string } | null
  etiqueta: string
  vista: VistaFoto
  tamano: "tabla" | "card"
  /** A row pending archive: nothing can be changed. */
  archivada?: boolean
  /** A save is running. */
  deshabilitado?: boolean
  alElegir: (id: string, archivo: File) => Promise<ResultadoDeElegir>
  alQuitar: (id: string) => void
  alDescartar: (id: string) => void
  alReintentar: (id: string) => void
}

const TIPOS = "image/jpeg,image/png,image/webp"

export function FotoVariante({
  id,
  propia,
  respaldo,
  etiqueta,
  vista,
  tamano,
  archivada,
  deshabilitado,
  alElegir,
  alQuitar,
  alDescartar,
  alReintentar,
}: PropsFotoVariante) {
  const entrada = useRef<HTMLInputElement>(null)
  const [rechazo, setRechazo] = useState<string | null>(null)

  const { pendiente, quitar, subida, errorAlQuitar } = vista
  const propiaVigente = subida !== null ? subida || null : propia
  const subiendo = pendiente?.estado === "subiendo"
  const bloqueado = !!archivada || !!deshabilitado
  const card = tamano === "card"

  // What the thumbnail shows, in order: the chosen file, nothing while it is marked for removal, the saved
  // photo, then a sibling's.
  const mostrada = pendiente ? pendiente.previa : quitar ? null : propiaVigente
  const prestada = !pendiente && !quitar && !propiaVigente ? respaldo : null
  const url = mostrada ?? prestada?.url ?? null
  const tieneFoto = !!pendiente || (!quitar && !!propiaVigente)

  const alCambiar = async (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0]
    // Without this reset the same file would not fire `change` again after a failed attempt.
    e.target.value = ""
    if (!archivo) return
    const r = await alElegir(id, archivo)
    setRechazo(r.ok ? null : r.mensaje)
  }

  const medida = card ? "h-14 w-14" : "h-10 w-10"
  const secundario = "min-h-11 rounded px-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
  const reintento = pendiente?.estado === "error" ? pendiente.mensaje : errorAlQuitar
  const textoDeReintento = pendiente ? "subir" : "quitar"

  return (
    <div data-testid={`foto-${id}`} className={card ? "flex items-center gap-3" : "flex flex-col items-start gap-1"}>
      <input
        ref={entrada}
        data-testid={`foto-input-${id}`}
        type="file"
        accept={TIPOS}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        disabled={bloqueado}
        onChange={alCambiar}
      />
      <button
        type="button"
        aria-label={`${tieneFoto ? "Cambiar" : "Agregar"} foto de ${etiqueta}`}
        disabled={bloqueado || subiendo}
        onClick={() => entrada.current?.click()}
        className={`relative flex ${medida} shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground transition-transform active:scale-[0.97] disabled:opacity-50 motion-reduce:transform-none ${quitar ? "border-dashed" : ""}`}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className={`h-full w-full object-cover ${prestada ? "opacity-60" : ""}`} />
        ) : (
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      <div className="flex min-w-0 flex-col items-start gap-0.5">
        {prestada && <span className="text-xs text-muted-foreground">Foto de {prestada.etiqueta || "otra variante"}</span>}
        {pendiente?.estado === "pendiente" && <span className="text-xs text-muted-foreground">Sin guardar</span>}
        {subiendo && (
          <p role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Subiendo foto…
          </p>
        )}
        {quitar && !errorAlQuitar && <span className="text-xs text-amber-900 dark:text-amber-200">Se quitará</span>}
        {reintento && (
          <p role="alert" className="text-xs text-destructive">
            {reintento}
          </p>
        )}
        {rechazo && (
          <p role="alert" className="text-xs text-destructive">
            {rechazo}
          </p>
        )}

        {reintento && (
          <button type="button" aria-label={`Reintentar ${textoDeReintento} la foto de ${etiqueta}`} disabled={bloqueado || subiendo} onClick={() => alReintentar(id)} className={secundario}>
            Reintentar
          </button>
        )}
        {pendiente && (
          <button type="button" aria-label={`Descartar foto de ${etiqueta}`} disabled={bloqueado || subiendo} onClick={() => {
              setRechazo(null)
              alDescartar(id)
            }} className={secundario}>
            Descartar
          </button>
        )}
        {!pendiente && !quitar && propiaVigente && (
          <button type="button" aria-label={`Quitar foto de ${etiqueta}`} disabled={bloqueado} onClick={() => alQuitar(id)} className={secundario}>
            Quitar
          </button>
        )}
        {quitar && (
          <button type="button" aria-label={`No quitar la foto de ${etiqueta}`} disabled={bloqueado} onClick={() => alQuitar(id)} className={secundario}>
            No quitar
          </button>
        )}
      </div>
    </div>
  )
}

interface PropsFotoDeFila {
  estado: VariantesState
  fila: Fila
  fotos: FotosVariantes
  tamano: "tabla" | "card"
  deshabilitado?: boolean
}

/** The slot wired to a row: label, own photo and the sibling fallback come from the state; the rest from the hook. */
export function FotoDeFila({ estado, fila, fotos, tamano, deshabilitado }: PropsFotoDeFila) {
  const etiqueta = etiquetaDeFila(estado, fila)
  const paraEnviar = { id: fila.id, imagenUrl: fila.imagenUrl, archivar: fila.archivar }
  return (
    <FotoVariante
      id={fila.id}
      etiqueta={etiqueta}
      propia={fila.imagenUrl}
      respaldo={respaldoDeFila(estado, fila)}
      vista={fotos.de(fila.id)}
      tamano={tamano}
      archivada={fila.archivar}
      deshabilitado={deshabilitado}
      alElegir={fotos.elegir}
      alQuitar={fotos.alternarQuitar}
      alDescartar={fotos.descartar}
      alReintentar={() => void fotos.reintentar(paraEnviar)}
    />
  )
}
