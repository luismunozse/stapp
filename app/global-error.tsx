"use client"

import { useEffect, useState } from "react"
import { generarRefCliente, reportarErrorCliente } from "@/lib/errores-cliente"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Se genera una vez por montaje: es lo que el usuario le pasa a soporte.
  const [ref] = useState(generarRefCliente)

  useEffect(() => {
    console.error("Global Error:", error)
    reportarErrorCliente(error, "global", ref)
  }, [error, ref])

  return (
    <html>
      <body>
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100dvh",
          fontFamily: "system-ui, sans-serif",
          padding: "2rem",
          textAlign: "center",
        }}>
          <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
            Algo salió mal
          </h2>
          <p style={{ color: "#666", marginBottom: "2rem" }}>
            Ocurrió un error inesperado. Intentá de nuevo.
          </p>
          {ref && (
            <p style={{ color: "#666", fontSize: "0.8rem", marginBottom: "1.5rem" }}>
              Si sigue pasando, pasale a soporte este código:{" "}
              <strong style={{ fontFamily: "monospace" }}>{ref}</strong>
            </p>
          )}
          <button
            onClick={reset}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
              fontSize: "1rem",
            }}
          >
            Intentar de nuevo
          </button>
        </div>
      </body>
    </html>
  )
}
