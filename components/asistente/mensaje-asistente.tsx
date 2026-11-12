"use client"

import { Fragment } from "react"
import Link from "next/link"
import { parseAsistenteLinks } from "@/lib/asistente/parse-links"
import { bloquesDeTexto } from "@/lib/asistente/bloques"

/** Texto con links internos y negritas (los links fuera del allowlist quedan como texto). */
function TextoEnLinea({ texto, onNavegar }: { texto: string; onNavegar: () => void }) {
  return (
    <>
      {parseAsistenteLinks(texto).map((seg, i) =>
        seg.type === "link" ? (
          <Link key={i} href={seg.href} onClick={onNavegar} className="underline text-primary font-medium">
            {seg.label}
          </Link>
        ) : seg.type === "bold" ? (
          <strong key={i}>{seg.text}</strong>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        )
      )}
    </>
  )
}

/** Una respuesta del asistente con formato: párrafos, listas, pasos numerados y títulos. */
export function MensajeAsistente({ contenido, onNavegar }: { contenido: string; onNavegar: () => void }) {
  return (
    <div className="space-y-2 break-words">
      {bloquesDeTexto(contenido).map((bloque, i) => {
        if (bloque.tipo === "titulo") {
          return (
            <p key={i} className="font-semibold">
              <TextoEnLinea texto={bloque.texto} onNavegar={onNavegar} />
            </p>
          )
        }
        if (bloque.tipo === "lista") {
          const Lista = bloque.ordenada ? "ol" : "ul"
          return (
            <Lista
              key={i}
              start={bloque.inicio}
              className={bloque.ordenada ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}
            >
              {bloque.items.map((item, j) => (
                <li key={j}>
                  <TextoEnLinea texto={item} onNavegar={onNavegar} />
                </li>
              ))}
            </Lista>
          )
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            <TextoEnLinea texto={bloque.texto} onNavegar={onNavegar} />
          </p>
        )
      })}
    </div>
  )
}
