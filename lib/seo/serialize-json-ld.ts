const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), "g")
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), "g")

/**
 * Serializa un objeto para inyectarlo en `<script type="application/ld+json">`.
 *
 * `JSON.stringify` NO es seguro ahí: un string con `</script>` cierra la
 * etiqueta y lo que sigue se ejecuta como HTML. En el catálogo público los
 * nombres y descripciones los escribe cada tenant, así que es XSS almacenado
 * en el dominio raíz. Se escapan `<`, `>`, `&` y los separadores U+2028/U+2029
 * como secuencias `\uXXXX`: el resultado sigue siendo JSON válido y se parsea
 * al mismo objeto.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029")
}
