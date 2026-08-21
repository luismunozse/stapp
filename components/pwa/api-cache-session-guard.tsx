"use client"

import { useEffect } from "react"
import { useSession } from "next-auth/react"
import { clearServiceWorkerCache } from "@/lib/sw-cache"

/** Identidad de sesion detras de lo que hay guardado en el cache del SW. */
export const SW_API_IDENTITY_KEY = "stapp-sw-api-identity"

/**
 * Tira el cache de API del service worker cuando cambia la identidad de sesion.
 *
 * El cache del SW lo comparte todo el perfil del navegador y su clave es la URL
 * sola: sin cookie, sin usuario, sin org. En un mostrador compartido el usuario
 * A de la org 1 abre la lista de clientes y cierra sesion; el usuario B de la
 * org 2 entra cinco minutos despues y stale-while-revalidate le sirve los
 * clientes de la org 1. Ninguna lista de rutas arregla eso — el problema no es
 * QUE se cachea sino que lo cacheado no sabe de quien es.
 *
 * Este componente es lo que le da esa noción: recuerda la identidad detras de
 * las respuestas guardadas y, cuando aparece OTRA, borra todo antes de que
 * pueda leerlo. Con eso las rutas de lectura vuelven a poder cachearse, que es
 * lo que le devuelve al POS el catalogo offline.
 *
 * Solo mira sesiones autenticadas, a proposito. Cerrar sesion no necesita
 * limpiar: a quien hay que proteger es a quien entra despues, y ese momento ya
 * esta cubierto — con la ventaja de que ahi hay red para volver a llenar el
 * cache. Limpiar en "loading"/"unauthenticated" ademas le vaciaria el catalogo
 * a la PWA offline justo mientras SessionRefresher restaura la sesion, que es
 * cuando el cache es lo unico que el operador tiene.
 */
export function ApiCacheSessionGuard() {
  const { data: session, status } = useSession()
  const user = session?.user

  const identidad = user
    ? [user.id, user.organizationId, user.role, user.sucursalId ?? ""].join("|")
    : null

  useEffect(() => {
    if (status !== "authenticated" || !identidad) return

    let previa: string | null = null
    try {
      previa = window.localStorage.getItem(SW_API_IDENTITY_KEY)
    } catch {
      // Sin poder leer quien estuvo antes no se puede afirmar que es el mismo,
      // y "no puedo verificar" tiene que resolverse del lado seguro.
      clearServiceWorkerCache()
      return
    }

    if (previa === identidad) return
    // Sin marca previa no hay sesion anterior de la cual protegerse: es el
    // primer login del equipo, y limpiar solo costaria el cache que ya trajo.
    if (previa) clearServiceWorkerCache()

    try {
      window.localStorage.setItem(SW_API_IDENTITY_KEY, identidad)
    } catch {
      // Sin marca la proxima identidad se vuelve a evaluar contra lo que haya:
      // se pierde precision, nunca seguridad.
    }
  }, [status, identidad])

  return null
}
