"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { compressImage } from "@/lib/image-compression"

/*
 * Photos of the combinations, staged OUTSIDE the variants reducer. A `File` or an object URL is not
 * serializable state: the reducer (and any draft built from it) only ever sees saved URLs. Here a photo
 * lives from "chosen" to "uploaded", one request per row through the item's own photo route
 * (`/api/inventario/{id}/imagen`, the same one the product form uses). Nothing is sent until
 * `subirTodas` runs, once the group is saved and every row id exists in the database.
 */

const TIPOS_PERMITIDOS = ["image/jpeg", "image/png", "image/webp"]
const MAXIMO_BYTES = 5 * 1024 * 1024
export const MAXIMO_SIMULTANEAS = 3

export type EstadoDeSubida = "pendiente" | "subiendo" | "error"

export interface FotoPendiente {
  /** Object URL of the chosen (compressed) file, for the preview. Revoked by the hook. */
  previa: string
  estado: EstadoDeSubida
  /** Why the last attempt failed (Spanish, ready to show). */
  mensaje?: string
}

export interface VistaFoto {
  pendiente: FotoPendiente | null
  /** The saved photo will be removed on the next upload round. */
  quitar: boolean
  /** The URL the row's own photo got in this session ("" = it was removed), or null if nothing happened. */
  subida: string | null
  /** Why removing the saved photo failed (Spanish), or null. */
  errorAlQuitar: string | null
}

/** What the hook needs to know about a row to decide what to send. */
export interface FilaParaFotos {
  id: string
  /** The row's OWN saved photo, if any. */
  imagenUrl: string | null
  /** Pending archive: nothing is sent for it. */
  archivar?: boolean
}

export type ResultadoDeElegir = { ok: true } | { ok: false; mensaje: string }

export interface ResultadoDeSubida {
  hechas: string[]
  fallidas: string[]
}

export interface FotosVariantes {
  de: (id: string) => VistaFoto
  elegir: (id: string, archivo: File) => Promise<ResultadoDeElegir>
  descartar: (id: string) => void
  alternarQuitar: (id: string) => void
  subirTodas: (filas: readonly FilaParaFotos[]) => Promise<ResultadoDeSubida>
  reintentar: (fila: FilaParaFotos) => Promise<boolean>
  /** Ids with a chosen file that is not saved yet. Ids only: never a File or an object URL. */
  idsConFotoPendiente: () => string[]
}

interface Entrada {
  archivo: File | null
  previa: string | null
  estado: EstadoDeSubida
  mensaje?: string
  quitar: boolean
  subida: string | null
}

const VACIA: VistaFoto = Object.freeze({ pendiente: null, quitar: false, subida: null, errorAlQuitar: null }) as VistaFoto

const MENSAJE_TIPO = "Elegí una foto en formato JPG, PNG o WebP."
const MENSAJE_PESO = "La foto pesa más de 5 MB. Elegí una más liviana."
const MENSAJE_PROCESO = "No pudimos preparar la foto. Probá con otra."
const MENSAJE_CERRADA = "Se cerró la pantalla antes de terminar. Elegí la foto de nuevo."
const MENSAJE_SUBIDA = "No se pudo subir la foto. Probá de nuevo."
const MENSAJE_QUITAR = "No se pudo quitar la foto. Probá de nuevo."

const entradaNueva = (): Entrada => ({ archivo: null, previa: null, estado: "pendiente", quitar: false, subida: null })

async function mensajeDe(res: Response, porDefecto: string): Promise<string> {
  const cuerpo = (await res.json().catch(() => null)) as { error?: unknown } | null
  return typeof cuerpo?.error === "string" && cuerpo.error ? cuerpo.error : porDefecto
}

export function useFotosVariantes(): FotosVariantes {
  const entradas = useRef(new Map<string, Entrada>())
  const [version, setVersion] = useState(0)
  const montado = useRef(true)
  // One send per row at a time: a second caller gets the first one's promise.
  const enCurso = useRef(new Map<string, Promise<boolean | null>>())

  const avisar = useCallback(() => {
    if (montado.current) setVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    montado.current = true
    const mapa = entradas.current
    return () => {
      montado.current = false
      for (const e of mapa.values()) {
        if (e.previa) URL.revokeObjectURL(e.previa)
        e.previa = null
      }
    }
  }, [])

  const tomar = (id: string): Entrada => {
    let e = entradas.current.get(id)
    if (!e) {
      e = entradaNueva()
      entradas.current.set(id, e)
    }
    return e
  }

  const soltarArchivo = (e: Entrada) => {
    if (e.previa) URL.revokeObjectURL(e.previa)
    e.archivo = null
    e.previa = null
    e.estado = "pendiente"
    e.mensaje = undefined
  }

  const elegir = useCallback(
    async (id: string, archivo: File): Promise<ResultadoDeElegir> => {
      if (!TIPOS_PERMITIDOS.includes(archivo.type)) return { ok: false, mensaje: MENSAJE_TIPO }
      if (archivo.size > MAXIMO_BYTES) return { ok: false, mensaje: MENSAJE_PESO }
      let comprimido: File
      try {
        comprimido = await compressImage(archivo)
      } catch {
        return { ok: false, mensaje: MENSAJE_PROCESO }
      }
      // The screen closed while the file was being prepared: keep no object URL nobody will revoke.
      if (!montado.current) return { ok: false, mensaje: MENSAJE_CERRADA }
      const e = tomar(id)
      soltarArchivo(e)
      e.archivo = comprimido
      e.previa = URL.createObjectURL(comprimido)
      e.quitar = false
      avisar()
      return { ok: true }
    },
    [avisar]
  )

  const descartar = useCallback(
    (id: string) => {
      const e = entradas.current.get(id)
      if (!e) return
      soltarArchivo(e)
      avisar()
    },
    [avisar]
  )

  const alternarQuitar = useCallback(
    (id: string) => {
      const e = tomar(id)
      e.quitar = !e.quitar
      if (e.quitar) soltarArchivo(e)
      else if (e.archivo === null) {
        e.estado = "pendiente"
        e.mensaje = undefined
      }
      avisar()
    },
    [avisar]
  )

  // One request for one row. Never throws: a failure is recorded on the row and reported as `false`.
  const enviarUna = useCallback(
    async (fila: FilaParaFotos): Promise<boolean | null> => {
      const e = entradas.current.get(fila.id)
      if (!e || fila.archivar) return null
      const subiendo = e.archivo !== null
      // The photo the row has NOW: the one uploaded in this session wins over the saved one ("" = removed).
      const vigente = e.subida !== null ? e.subida : fila.imagenUrl
      const borrando = !subiendo && e.quitar && !!vigente
      if (!subiendo && !borrando) return null

      const archivo = e.archivo
      e.estado = "subiendo"
      e.mensaje = undefined
      avisar()
      try {
        let res: Response
        if (archivo) {
          const datos = new FormData()
          datos.append("file", archivo)
          res = await fetch(`/api/inventario/${fila.id}/imagen`, { method: "POST", body: datos })
        } else {
          res = await fetch(`/api/inventario/${fila.id}/imagen`, { method: "DELETE" })
        }
        if (!res.ok) {
          e.estado = "error"
          e.mensaje = await mensajeDe(res, archivo ? MENSAJE_SUBIDA : MENSAJE_QUITAR)
          avisar()
          return false
        }
        if (archivo) {
          const cuerpo = (await res.json().catch(() => null)) as { imagenUrl?: unknown } | null
          e.subida = typeof cuerpo?.imagenUrl === "string" ? cuerpo.imagenUrl : ""
          soltarArchivo(e)
        } else {
          e.subida = ""
          e.quitar = false
        }
        avisar()
        return true
      } catch {
        e.estado = "error"
        e.mensaje = archivo ? MENSAJE_SUBIDA : MENSAJE_QUITAR
        avisar()
        return false
      }
    },
    [avisar]
  )

  const enviar = useCallback(
    (fila: FilaParaFotos): Promise<boolean | null> => {
      const previo = enCurso.current.get(fila.id)
      if (previo) return previo
      const p = enviarUna(fila).finally(() => enCurso.current.delete(fila.id))
      enCurso.current.set(fila.id, p)
      return p
    },
    [enviarUna]
  )

  const subirTodas = useCallback(
    async (filas: readonly FilaParaFotos[]): Promise<ResultadoDeSubida> => {
      const resultado: ResultadoDeSubida = { hechas: [], fallidas: [] }
      const cola = [...filas]
      const trabajador = async () => {
        for (let fila = cola.shift(); fila; fila = cola.shift()) {
          const ok = await enviar(fila)
          if (ok === true) resultado.hechas.push(fila.id)
          else if (ok === false) resultado.fallidas.push(fila.id)
        }
      }
      await Promise.all(Array.from({ length: MAXIMO_SIMULTANEAS }, trabajador))
      return resultado
    },
    [enviar]
  )

  const reintentar = useCallback(async (fila: FilaParaFotos) => (await enviar(fila)) === true, [enviar])

  const de = useCallback(
    (id: string): VistaFoto => {
      void version
      const e = entradas.current.get(id)
      if (!e) return VACIA
      return {
        pendiente: e.archivo && e.previa ? { previa: e.previa, estado: e.estado, ...(e.mensaje ? { mensaje: e.mensaje } : {}) } : null,
        quitar: e.quitar,
        subida: e.subida,
        errorAlQuitar: e.archivo === null && e.quitar && e.estado === "error" ? (e.mensaje ?? null) : null,
      }
    },
    [version]
  )

  const idsConFotoPendiente = useCallback(() => {
    void version
    return [...entradas.current.entries()].filter(([, e]) => e.archivo !== null).map(([id]) => id)
  }, [version])

  return useMemo(
    () => ({ de, elegir, descartar, alternarQuitar, subirTodas, reintentar, idsConFotoPendiente }),
    [de, elegir, descartar, alternarQuitar, subirTodas, reintentar, idsConFotoPendiente]
  )
}
