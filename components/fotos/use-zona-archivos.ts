"use client"

import { useEffect, useId, useRef, useState } from "react"

/** Con varias zonas en pantalla (recepcion de varios equipos) el pegado va a
 *  la ultima sobre la que se paso el puntero o se hizo foco. */
let zonaActiva: string | null = null

/** Las ayudas de arrastrar/pegar solo se muestran con mouse: en el celular no
 *  aplican y ahi ya estan los botones de galeria y camara. */
export const SOLO_PC = "hidden [@media(hover:hover)_and_(pointer:fine)]:block"

function esArrastreDeArchivos(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes("Files")
}

interface ZonaArchivosOptions {
  /** Recibe los archivos arrastrados (sin filtrar) o las imagenes pegadas. */
  onFiles: (files: File[]) => void
  /** Mientras es true no se aceptan archivos (p. ej. comprimiendo o subiendo). */
  deshabilitada?: boolean
}

/**
 * Carga de imagenes desde PC: convierte un contenedor en zona para soltar
 * archivos y escucha el pegado (Ctrl+V) en toda la pantalla.
 * Los `zonaProps` van en el contenedor que debe aceptar el arrastre.
 */
export function useZonaArchivos({ onFiles, deshabilitada = false }: ZonaArchivosOptions) {
  const id = useId()
  const [arrastrando, setArrastrando] = useState(false)
  // dragenter/dragleave se disparan por cada hijo que cruza el puntero: se
  // cuenta la profundidad para no parpadear el resaltado.
  const dragDepth = useRef(0)

  // Los listeners de documento leen siempre el ultimo valor sin re-suscribirse.
  const onFilesRef = useRef(onFiles)
  const deshabilitadaRef = useRef(deshabilitada)
  useEffect(() => {
    onFilesRef.current = onFiles
    deshabilitadaRef.current = deshabilitada
  })

  useEffect(() => {
    if (zonaActiva === null) zonaActiva = id

    // Pegar una captura o una imagen copiada en cualquier parte de la
    // pantalla la suma a esta zona.
    const onPaste = (e: ClipboardEvent) => {
      if (zonaActiva !== id || deshabilitadaRef.current) return
      const imagenes = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/")
      )
      if (imagenes.length === 0) return
      // Word/Excel copian texto + una imagen del texto: si se esta
      // escribiendo en un campo, gana el pegado de texto.
      const target = e.target as HTMLElement | null
      const enCampo =
        !!target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      if (enCampo && e.clipboardData?.types.includes("text/plain")) return
      e.preventDefault()
      onFilesRef.current(imagenes)
    }

    // Soltar un archivo fuera de la zona haria que el navegador lo abra y se
    // pierda lo cargado: se anula ese comportamiento mientras la zona exista.
    const bloquearNavegacion = (e: DragEvent) => {
      if (esArrastreDeArchivos(e.dataTransfer)) e.preventDefault()
    }

    document.addEventListener("paste", onPaste)
    document.addEventListener("dragover", bloquearNavegacion)
    document.addEventListener("drop", bloquearNavegacion)
    return () => {
      document.removeEventListener("paste", onPaste)
      document.removeEventListener("dragover", bloquearNavegacion)
      document.removeEventListener("drop", bloquearNavegacion)
      if (zonaActiva === id) zonaActiva = null
    }
  }, [id])

  const marcarActiva = () => {
    zonaActiva = id
  }

  const zonaProps = {
    onPointerEnter: marcarActiva,
    onFocusCapture: marcarActiva,
    onDragEnter: (e: React.DragEvent) => {
      if (!esArrastreDeArchivos(e.dataTransfer)) return
      e.preventDefault()
      dragDepth.current += 1
      setArrastrando(true)
    },
    onDragOver: (e: React.DragEvent) => {
      if (!esArrastreDeArchivos(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = deshabilitada ? "none" : "copy"
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!esArrastreDeArchivos(e.dataTransfer)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setArrastrando(false)
    },
    onDrop: (e: React.DragEvent) => {
      if (!esArrastreDeArchivos(e.dataTransfer)) return
      e.preventDefault()
      dragDepth.current = 0
      setArrastrando(false)
      marcarActiva()
      if (deshabilitada) return
      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) onFiles(files)
    },
  }

  return { arrastrando, zonaProps }
}
