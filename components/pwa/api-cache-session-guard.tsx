"use client"

import { useEffect } from "react"
import { useSession } from "next-auth/react"
import { clearServiceWorkerApiCache } from "@/lib/sw-cache"

/** Identidad de sesion detras de lo que hay guardado en el cache del SW. */
export const SW_API_IDENTITY_KEY = "stapp-sw-api-identity"

function recordar(identidad: string) {
  try {
    window.localStorage.setItem(SW_API_IDENTITY_KEY, identidad)
  } catch {
    // Sin marca la proxima identidad se vuelve a evaluar contra lo que haya:
    // se pierde precision, nunca seguridad.
  }
}

/**
 * Tira el cache de API del service worker cuando cambia la identidad de sesion.
 *
 * DEFENSA EN PROFUNDIDAD, no la garantia. Lo que aisla las respuestas de una
 * sesion de las de otra es que las rutas que dependen de la identidad no se
 * cachean (ver CACHEABLE_API_ROUTES en public/sw.js). Este componente cubre lo
 * que igual pueda haber quedado guardado: entradas de una version anterior del
 * SW, o de una ruta que alguien agregue a esa lista sin darse cuenta.
 *
 * No sirve como garantia porque limpiar es una carrera por construccion: tiene
 * que haber TERMINADO antes de que algo lea, y la primera pantalla dispara sus
 * fetch en el mismo commit en que este efecto corre. Tampoco puede afirmar que
 * corrio: sin `controller` el mensaje no llega a ningun lado. Por eso la
 * identidad solo se guarda cuando el worker CONFIRMA el borrado — un guard que
 * miente sobre haber corrido es peor que no tener guard.
 *
 * Solo mira sesiones autenticadas, a proposito. Cerrar sesion no necesita
 * limpiar: a quien hay que proteger es a quien entra despues, y ese momento ya
 * esta cubierto — con la ventaja de que ahi hay red. Limpiar en
 * "loading"/"unauthenticated" ademas dispararia en cada restauracion de sesion
 * de la PWA, incluso sin red, sin proteger a nadie que el login siguiente no
 * proteja igual.
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
      void clearServiceWorkerApiCache()
      return
    }

    if (previa === identidad) return

    // Ojo con la tentacion de saltear la limpieza cuando NO hay marca previa:
    // que no haya marca no prueba que no haya habido nadie antes. `recordar()`
    // se traga su propio fallo (Safari en privado, cuota), asi que una sesion
    // anterior pudo llenar el cache y no dejar rastro; leer esa ausencia como
    // "equipo nuevo" serviria ese cache al usuario siguiente, que es exactamente
    // el caso para el que existe este guard. En un equipo realmente nuevo la
    // limpieza de mas cuesta el cache que la propia sesion acaba de traer.
    let cancelado = false
    void clearServiceWorkerApiCache().then((limpio) => {
      // SOLO si el worker confirmo el borrado. Sin controller el mensaje no
      // llega a ningun lado (force-reload, SW nuevo activandose antes de
      // clients.claim(), registro fallido): anotar la identidad ahi seria
      // afirmar una limpieza que no ocurrio, y el guard no volveria a intentar
      // NUNCA — el cache de la sesion anterior quedaria servido de manera
      // permanente. Al no anotar nada, el proximo montaje lo reintenta.
      if (limpio && !cancelado) recordar(identidad)
    })
    return () => {
      cancelado = true
    }
  }, [status, identidad])

  return null
}
