/**
 * Fotos para el informe técnico de la orden.
 *
 * Solo los tipos que ya ve el cliente en el seguimiento (INGRESO, REPARACION,
 * ENTREGA): las de DIAGNOSTICO y COMPONENTE son internas del taller. El bucket
 * es privado, así que cada foto se baja del Storage y se pasa a JPEG chico
 * (react-pdf solo dibuja JPG y PNG, y una foto de celular pesa varios MB).
 * Una foto que no se puede leer se saltea: el informe sale igual.
 */
import sharp from "sharp"
import { supabaseAdmin, STORAGE_BUCKETS } from "@/lib/supabase"
import { pathDesdeReferencia } from "@/lib/storage-privado"

export const TIPOS_FOTO_INFORME = ["INGRESO", "REPARACION", "ENTREGA"] as const
/** Tope de fotos por informe: más que esto lo vuelve pesado para mandar por WhatsApp. */
export const MAX_FOTOS_INFORME = 12
/** Lado mayor de cada foto, en px: alcanza para verla nítida a media hoja. */
const LADO_MAX_PX = 1000

export const ETIQUETA_TIPO_FOTO: Record<(typeof TIPOS_FOTO_INFORME)[number], string> = {
  INGRESO: "Al ingresar",
  REPARACION: "Durante la reparación",
  ENTREGA: "Al entregar",
}

export interface FotoInforme {
  tipo: (typeof TIPOS_FOTO_INFORME)[number]
  descripcion: string | null
  fecha: Date
  /** JPEG ya reducido. */
  jpeg: Buffer
}

interface FotoRow {
  url: string | null
  storage_path: string | null
  tipo: string
  descripcion: string | null
  created_at: string
}

/** Cualquier imagen -> JPEG con la orientación del celular aplicada y el lado mayor acotado. */
export async function aJpegInforme(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({ width: LADO_MAX_PX, height: LADO_MAX_PX, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 72 })
    .toBuffer()
}

/** La orden ya tiene que estar verificada dentro del alcance de quien pide (lo hace la ruta). */
export async function cargarFotosInforme(ordenId: string): Promise<FotoInforme[]> {
  const { data, error } = await supabaseAdmin
    .from("fotos_orden")
    .select("url, storage_path, tipo, descripcion, created_at")
    .eq("orden_id", ordenId)
    .in("tipo", [...TIPOS_FOTO_INFORME])
    .order("created_at", { ascending: true })
    .limit(MAX_FOTOS_INFORME)

  if (error) {
    console.error("[informe] fotos lookup failed:", error)
    return []
  }

  const filas = ((data ?? []) as unknown as FotoRow[]).filter((f) =>
    (TIPOS_FOTO_INFORME as readonly string[]).includes(f.tipo)
  )

  const fotos = await Promise.all(
    filas.map(async (f): Promise<FotoInforme | null> => {
      const path = pathDesdeReferencia("FOTOS_ORDENES", f.storage_path) ?? pathDesdeReferencia("FOTOS_ORDENES", f.url)
      if (!path) return null
      try {
        const { data: blob, error: dlError } = await supabaseAdmin.storage.from(STORAGE_BUCKETS.FOTOS_ORDENES).download(path)
        if (dlError || !blob) throw dlError ?? new Error("sin datos")
        const jpeg = await aJpegInforme(Buffer.from(await blob.arrayBuffer()))
        return {
          tipo: f.tipo as FotoInforme["tipo"],
          descripcion: f.descripcion,
          fecha: new Date(f.created_at),
          jpeg,
        }
      } catch (err) {
        console.error("[informe] no se pudo leer una foto:", path, err)
        return null
      }
    })
  )
  return fotos.filter((f): f is FotoInforme => f !== null)
}
