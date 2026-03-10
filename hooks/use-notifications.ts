"use client"

import { useEffect, useRef, useCallback } from "react"
import useSWR from "swr"
import { useSWRConfig } from "swr"
import { getSupabaseClient } from "@/lib/supabase-client"
import { useSession } from "next-auth/react"
import type { UserNotification } from "@/types/database"
import type { RealtimeChannel } from "@supabase/supabase-js"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function useNotifications() {
  const { data: session } = useSession()
  const organizationId = session?.user?.organizationId
  const userId = session?.user?.id
  const { mutate: globalMutate } = useSWRConfig()
  const channelRef = useRef<RealtimeChannel | null>(null)

  // Unread count - siempre activo
  const {
    data: countData,
    mutate: mutateCount,
  } = useSWR<{ count: number }>(
    organizationId ? "/api/user-notifications/unread-count" : null,
    fetcher,
    { refreshInterval: 60000 }
  )

  // Lista de notificaciones
  const {
    data: listData,
    mutate: mutateList,
    isLoading,
  } = useSWR<{ notifications: UserNotification[]; nextCursor: string | null }>(
    organizationId ? "/api/user-notifications?limit=20" : null,
    fetcher
  )

  // Realtime subscription
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
          // Filtrar client-side por user_id
          if (payload.new && (payload.new as UserNotification).user_id === userId) {
            mutateCount()
            mutateList()
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

  const markAsRead = useCallback(async (id: string) => {
    await fetch(`/api/user-notifications/${id}/read`, { method: "PATCH" })
    mutateCount()
    mutateList()
  }, [mutateCount, mutateList])

  const markAllAsRead = useCallback(async () => {
    await fetch("/api/user-notifications/mark-all-read", { method: "PATCH" })
    mutateCount()
    mutateList()
  }, [mutateCount, mutateList])

  return {
    unreadCount: countData?.count || 0,
    notifications: listData?.notifications || [],
    nextCursor: listData?.nextCursor || null,
    isLoading,
    markAsRead,
    markAllAsRead,
    refresh: () => {
      mutateCount()
      mutateList()
    },
  }
}
