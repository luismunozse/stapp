"use client"

import { useCallback, useEffect, useState } from "react"

const MAX_RECIENTES = 20

function keyRecientes(slug: string) {
  return `catalogo:${slug}:recientes`
}

function keyFavoritos(slug: string) {
  return `catalogo:${slug}:favoritos`
}

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch { /* quota / private mode */ }
}

export function useRecientes(slug: string) {
  const [ids, setIds] = useState<string[]>([])

  useEffect(() => {
    setIds(readJSON<string[]>(keyRecientes(slug), []))
  }, [slug])

  const push = useCallback((itemId: string) => {
    setIds((prev) => {
      const next = [itemId, ...prev.filter((id) => id !== itemId)].slice(0, MAX_RECIENTES)
      writeJSON(keyRecientes(slug), next)
      return next
    })
  }, [slug])

  const clear = useCallback(() => {
    setIds([])
    writeJSON(keyRecientes(slug), [])
  }, [slug])

  return { ids, push, clear }
}

export function useFavoritos(slug: string) {
  const [ids, setIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const arr = readJSON<string[]>(keyFavoritos(slug), [])
    setIds(new Set(arr))
  }, [slug])

  const toggle = useCallback((itemId: string) => {
    setIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      writeJSON(keyFavoritos(slug), Array.from(next))
      return next
    })
  }, [slug])

  const has = useCallback((itemId: string) => ids.has(itemId), [ids])

  const clear = useCallback(() => {
    setIds(new Set())
    writeJSON(keyFavoritos(slug), [])
  }, [slug])

  return { ids, has, toggle, clear, count: ids.size }
}
