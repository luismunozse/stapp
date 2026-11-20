import { Fragment } from "react"

// Solo http(s): el texto viene de un mensaje y no se interpreta como HTML ni
// se aceptan otros esquemas (javascript:, data:).
const URL_RE = /(https?:\/\/[^\s<>"']+)/g
// Puntuacion que suele quedar pegada al final de un enlace escrito en una frase.
const COLA_RE = /[.,;:!?)\]]+$/

/** Texto plano de un mensaje con sus enlaces http(s) clicables. */
export function TextoConEnlaces({ texto }: { texto: string }) {
  const partes = texto.split(URL_RE)
  return (
    <>
      {partes.map((parte, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{parte}</Fragment>
        const cola = parte.match(COLA_RE)?.[0] ?? ""
        const url = cola ? parte.slice(0, -cola.length) : parte
        return (
          <Fragment key={i}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 break-all"
            >
              {url}
            </a>
            {cola}
          </Fragment>
        )
      })}
    </>
  )
}
