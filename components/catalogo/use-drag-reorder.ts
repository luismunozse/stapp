"use client"

import { useCallback, useRef, useState } from "react"

/**
 * Hook minimalista de drag-reorder con HTML5 native DnD.
 * No requiere libs externas. Devuelve handlers + estado dragging para feedback visual.
 */
export function useDragReorder<T extends { id: string }>(
  items: T[],
  onReorder: (next: T[]) => void
) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dragSrcIndex = useRef<number | null>(null)

  const onDragStart = useCallback(
    (index: number) => (e: React.DragEvent) => {
      dragSrcIndex.current = index
      setDraggingId(items[index].id)
      e.dataTransfer.effectAllowed = "move"
      e.dataTransfer.setData("text/plain", items[index].id)
    },
    [items]
  )

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
  }, [])

  const onDrop = useCallback(
    (targetIndex: number) => (e: React.DragEvent) => {
      e.preventDefault()
      const src = dragSrcIndex.current
      if (src === null || src === targetIndex) {
        setDraggingId(null)
        return
      }
      const next = [...items]
      const [moved] = next.splice(src, 1)
      next.splice(targetIndex, 0, moved)
      dragSrcIndex.current = null
      setDraggingId(null)
      onReorder(next)
    },
    [items, onReorder]
  )

  const onDragEnd = useCallback(() => {
    dragSrcIndex.current = null
    setDraggingId(null)
  }, [])

  return { draggingId, onDragStart, onDragOver, onDrop, onDragEnd }
}
