/**
 * Helpers de la carga de certificado ARCA en Configuración.
 *
 * Viven fuera del componente para poder testear el caso que más soporte
 * genera: el usuario sube el `.csr` en vez del `.crt`. Los dos archivos
 * quedan juntos en la misma carpeta cuando se genera el pedido, y sin
 * distinguirlos el servidor solo responde "no es un PEM X.509 válido".
 */

export type TipoPem = "certificado" | "clave" | "solicitud" | "desconocido"

const ENCABEZADOS: Array<{ marca: string; tipo: TipoPem }> = [
  // El CSR va primero: "CERTIFICATE REQUEST" contiene "CERTIFICATE".
  { marca: "-----BEGIN CERTIFICATE REQUEST-----", tipo: "solicitud" },
  { marca: "-----BEGIN NEW CERTIFICATE REQUEST-----", tipo: "solicitud" },
  { marca: "-----BEGIN CERTIFICATE-----", tipo: "certificado" },
  { marca: "-----BEGIN PRIVATE KEY-----", tipo: "clave" },
  { marca: "-----BEGIN RSA PRIVATE KEY-----", tipo: "clave" },
  { marca: "-----BEGIN ENCRYPTED PRIVATE KEY-----", tipo: "clave" },
]

export function clasificarPem(texto: string): TipoPem {
  const limpio = (texto ?? "").trim()
  for (const { marca, tipo } of ENCABEZADOS) {
    if (limpio.startsWith(marca)) return tipo
  }
  return "desconocido"
}

/**
 * `FileReader` sin `onerror` deja la promesa colgada para siempre y el botón
 * se queda en "Conectando..." sin explicar nada. Acá siempre se resuelve o
 * se rechaza.
 */
export function leerArchivoComoTexto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    let reader: FileReader
    try {
      reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ""))
      reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer el archivo"))
      reader.onabort = () => reject(new Error("Lectura del archivo cancelada"))
      reader.readAsText(file)
    } catch (e) {
      reject(e instanceof Error ? e : new Error("No se pudo leer el archivo"))
    }
  })
}
