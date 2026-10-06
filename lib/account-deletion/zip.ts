import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate"

export interface ZipWriter {
  addText(name: string, text: string): void
  /** `store: true` para contenido ya comprimido (PDF): no gasta CPU en deflate. */
  addBytes(name: string, data: Uint8Array, opts?: { store?: boolean }): void
}

/**
 * ZIP que sale por chunks a medida que `fill` agrega archivos. No hay
 * backpressure (los chunks se encolan apenas se generan), así que la memoria
 * queda acotada por el tamaño total del ZIP: los topes de PDFs del export la
 * mantienen en ~100 MB más los CSV.
 */
export function buildZipStream(fill: (zip: ZipWriter) => Promise<void>): ReadableStream<Uint8Array> {
  // `failed` cubre error de fflate/fill y cancelacion del cliente: tras eso
  // ningun callback pendiente puede encolar en un stream ya cerrado.
  let failed = false
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const fail = (err: unknown) => {
        if (failed) return
        failed = true
        controller.error(err)
      }
      const zip = new Zip((err, chunk, final) => {
        if (failed) return
        if (err) {
          fail(err)
          return
        }
        controller.enqueue(chunk)
        if (final) controller.close()
      })

      const add = (name: string, data: Uint8Array, store: boolean) => {
        if (failed) throw new Error("ZIP cancelado")
        const file = store ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 })
        zip.add(file)
        file.push(data, true)
      }

      try {
        await fill({
          addText: (name, text) => add(name, strToU8(text), false),
          addBytes: (name, data, opts) => add(name, data, !!opts?.store),
        })
        zip.end()
      } catch (err) {
        fail(err)
      }
    },
    cancel() {
      // Abort del cliente: `fill` se detiene en su proximo addText/addBytes
      // (add tira), asi no sigue leyendo PDFs para nadie.
      failed = true
    },
  })
}
