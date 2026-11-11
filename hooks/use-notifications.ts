"use client"

import { useRef, useCallback } from "react"
import useSWR from "swr"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import type { UserNotification } from "@/types/database"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type CountData = { count: number }
type ListData = { notifications: UserNotification[]; nextCursor: string | null }

/** Cada cuánto se consulta el contador de no leídas. SWR no consulta con la pestaña oculta. */
export const INTERVALO_NOTIFICACIONES_MS = 15000

/**
 * Campanita: no usa Supabase Realtime. La tabla user_notifications está cerrada
 * a anon (migración 395) y nunca estuvo en la publicación de Realtime, así que
 * la suscripción no recibía nada. Se consulta el contador por el servidor; si
 * sube, se recarga la lista y se avisa (sonido + toast) por cada no leída nueva.
 */
export function useNotifications() {
  const { data: session } = useSession()
  const router = useRouter()
  const organizationId = session?.user?.organizationId
  const userId = session?.user?.id

  // Ids ya vistos. null = todavía no cargó la primera lista (no se avisa lo viejo).
  const vistasRef = useRef<Set<string> | null>(null)
  const ultimoConteoRef = useRef<number | null>(null)

  const avisar = useCallback((n: UserNotification) => {
    try {
      const audio = new Audio("/sounds/notification.mp3")
      audio.volume = 0.3
      audio.play().catch(() => {})
    } catch {}

    if (n.action_url) {
      toast(n.title, {
        description: n.body,
        duration: 6000,
        action: { label: "Ver", onClick: () => router.push(n.action_url!) },
      })
    } else {
      toast(n.title, { description: n.body, duration: 5000 })
    }
  }, [router])

  // Lista de notificaciones
  const {
    data: listData,
    mutate: mutateList,
    isLoading,
  } = useSWR<ListData>(
    organizationId && userId ? "/api/user-notifications?limit=20" : null,
    fetcher,
    {
      onSuccess: (data) => {
        const lista = data?.notifications ?? []
        const vistas = vistasRef.current
        if (vistas) {
          for (const n of lista) {
            if (!n.read_at && !vistas.has(n.id)) avisar(n)
          }
        }
        vistasRef.current = new Set([...(vistas ?? []), ...lista.map((n) => n.id)])
      },
    }
  )

  // Unread count
  const {
    data: countData,
    mutate: mutateCount,
  } = useSWR<CountData>(
    organizationId && userId ? "/api/user-notifications/unread-count" : null,
    fetcher,
    {
      refreshInterval: INTERVALO_NOTIFICACIONES_MS,
      onSuccess: (data) => {
        const conteo = typeof data?.count === "number" ? data.count : null
        const anterior = ultimoConteoRef.current
        ultimoConteoRef.current = conteo
        if (conteo !== null && anterior !== null && conteo > anterior) mutateList()
      },
    }
  )

  // Las bajas optimistas no pasan por onSuccess: sin esto el próximo conteo
  // del servidor, ya con una notificación nueva, empataría el viejo y no avisaría.
  const bajarConteo = useCallback((n: number) => {
    if (ultimoConteoRef.current !== null) {
      ultimoConteoRef.current = Math.max(0, ultimoConteoRef.current - n)
    }
  }, [])

  // Optimistic mark as read (#1)
  const markAsRead = useCallback(async (id: string) => {
    const now = new Date().toISOString()

    // Optimistic update lista
    mutateList((current) => {
      if (!current) return current
      return {
        ...current,
        notifications: current.notifications.map((n) =>
          n.id === id ? { ...n, read_at: now } : n
        ),
      }
    }, { revalidate: false })

    // Optimistic update count
    bajarConteo(1)
    mutateCount((current) =>
      current ? { count: Math.max(0, current.count - 1) } : current,
      { revalidate: false }
    )

    // Fire request (no await - fire and forget)
    fetch(`/api/user-notifications/${id}/read`, { method: "PATCH" })
  }, [mutateCount, mutateList, bajarConteo])

  // Optimistic mark all as read (#1)
  const markAllAsRead = useCallback(async () => {
    const now = new Date().toISOString()

    mutateList((current) => {
      if (!current) return current
      return {
        ...current,
        notifications: current.notifications.map((n) =>
          !n.read_at ? { ...n, read_at: now } : n
        ),
      }
    }, { revalidate: false })

    ultimoConteoRef.current = 0
    mutateCount({ count: 0 }, { revalidate: false })

    fetch("/api/user-notifications/mark-all-read", { method: "PATCH" })
  }, [mutateCount, mutateList])

  // Dismiss / eliminar notificacion (#8)
  const dismiss = useCallback(async (id: string) => {
    mutateList((current) => {
      if (!current) return current
      return {
        ...current,
        notifications: current.notifications.filter((n) => n.id !== id),
      }
    }, { revalidate: false })

    // Si era unread, decrementar count
    const wasUnread = listData?.notifications.find((n) => n.id === id && !n.read_at)
    if (wasUnread) {
      bajarConteo(1)
      mutateCount((current) =>
        current ? { count: Math.max(0, current.count - 1) } : current,
        { revalidate: false }
      )
    }

    fetch(`/api/user-notifications/${id}`, { method: "DELETE" })
  }, [mutateCount, mutateList, listData, bajarConteo])

  return {
    unreadCount: countData?.count || 0,
    notifications: listData?.notifications || [],
    nextCursor: listData?.nextCursor || null,
    isLoading,
    markAsRead,
    markAllAsRead,
    dismiss,
    refresh: () => {
      mutateCount()
      mutateList()
    },
  }
}
