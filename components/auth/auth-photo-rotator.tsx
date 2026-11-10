"use client"

import Image from "next/image"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

const FOTOS = [
  "/fondo-login.avif",
  "/fondo-login-2.avif",
  "/fondo-login-3.avif",
  "/fondo-login-4.avif",
]
const INTERVALO_MS = 6000

/**
 * Fotos del panel de acceso apiladas, alternándose con un fundido. Todas se
 * renderizan desde el SSR (la primera visible); el resto se descarga mientras
 * se muestra la primera, así el cambio no espera. Con `prefers-reduced-motion`
 * queda fija la primera.
 */
export function AuthPhotoRotator() {
  const [activa, setActiva] = useState(0)

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const id = window.setInterval(() => {
      setActiva((i) => (i + 1) % FOTOS.length)
    }, INTERVALO_MS)
    return () => window.clearInterval(id)
  }, [])

  return (
    <>
      {FOTOS.map((src, i) => (
        <Image
          key={src}
          src={src}
          alt=""
          fill
          sizes="55vw"
          // Solo la primera compite por el LCP; el resto baja después
          loading={i === 0 ? "eager" : "lazy"}
          className={cn(
            "object-cover object-center transition-opacity duration-[1500ms] ease-in-out",
            i === activa ? "opacity-100" : "opacity-0",
          )}
        />
      ))}
    </>
  )
}
