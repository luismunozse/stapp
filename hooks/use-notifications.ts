"use client"

import { useEffect, useRef, useCallback } from "react"
import useSWR from "swr"
import { getSupabaseClient } from "@/lib/supabase-client"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import type { UserNotification } from "@/types/database"
import type { RealtimeChannel } from "@supabase/supabase-js"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type CountData = { count: number }
type ListData = { notifications: UserNotification[]; nextCursor: string | null }

export function useNotifications() {
  const { data: session } = useSession()
  const organizationId = session?.user?.organizationId
  const userId = session?.user?.id
  const channelRef = useRef<RealtimeChannel | null>(null)

  // Unread count
  const {
    data: countData,
    mutate: mutateCount,
  } = useSWR<CountData>(
    organizationId ? "/api/user-notifications/unread-count" : null,
    fetcher,
    { refreshInterval: 60000 }
  )

  // Lista de notificaciones
  const {
    data: listData,
    mutate: mutateList,
    isLoading,
  } = useSWR<ListData>(
    organizationId ? "/api/user-notifications?limit=20" : null,
    fetcher
  )

  // Realtime subscription con sonido + toast (#5, #6)
  useEffect(() => {
    if (!organizationId || !userId) return

    const supabase = getSupabaseClient()

    const channel = supabase
      .channel(`user-notifications-${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_notifications",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          if (payload.new && (payload.new as UserNotification).user_id === userId) {
            const n = payload.new as UserNotification
            mutateCount()
            mutateList()

            // Sonido de notificacion
            try {
              const audio = new Audio("/sounds/notification.mp3")
              audio.volume = 0.3
              audio.play().catch(() => {})
            } catch {}

            // Toast visual
            toast(n.title, {
              description: n.body,
              duration: 5000,
            })
          }
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [organizationId, userId, mutateCount, mutateList])

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
    mutateCount((current) =>
      current ? { count: Math.max(0, current.count - 1) } : current,
      { revalidate: false }
    )

    // Fire request (no await - fire and forget)
    fetch(`/api/user-notifications/${id}/read`, { method: "PATCH" })
  }, [mutateCount, mutateList])

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
      mutateCount((current) =>
        current ? { count: Math.max(0, current.count - 1) } : current,
        { revalidate: false }
      )
    }

    fetch(`/api/user-notifications/${id}`, { method: "DELETE" })
  }, [mutateCount, mutateList, listData])

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
