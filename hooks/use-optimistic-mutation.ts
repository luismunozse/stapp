"use client"

import { useCallback, useRef } from "react"
import { useSWRConfig } from "swr"

interface MutationOptions<TData, TInput> {
  /** Genera datos optimistas a partir de los datos actuales del caché */
  optimisticData?: (current: TData | undefined, input: TInput) => TData
  /** Revalidar después de la mutación (default: true) */
  revalidate?: boolean
  /** Rollback automático en error (default: true) */
  rollbackOnError?: boolean
  /** Callback en éxito */
  onSuccess?: (data: unknown) => void
  /** Callback en error */
  onError?: (error: Error) => void
}

/**
 * Hook para mutaciones optimistas con SWR.
 * Actualiza la UI inmediatamente y revierte si la API falla.
 *
 * @example
 * const { trigger, isMutating } = useOptimisticMutation<OrdenServicio[], { id: string }>(
 *   apiUrl,
 *   async (input) => {
 *     const res = await fetch(`/api/ordenes/${input.id}`, { method: 'DELETE' })
 *     if (!res.ok) throw new Error('Error')
 *     return res.json()
 *   },
 *   {
 *     optimisticData: (current, input) =>
 *       ({ ...current, data: current?.data?.filter(o => o.id !== input.id) }),
 *   }
 * )
 */
export function useOptimisticMutation<TData = unknown, TInput = unknown>(
  key: string | null,
  mutationFn: (input: TInput) => Promise<unknown>,
  options: MutationOptions<TData, TInput> = {}
) {
  const { mutate } = useSWRConfig()
  const isMutatingRef = useRef(false)

  const {
    optimisticData,
    revalidate = true,
    rollbackOnError = true,
    onSuccess,
    onError,
  } = options

  const trigger = useCallback(
    async (input: TInput) => {
      if (!key) return
      isMutatingRef.current = true

      try {
        if (optimisticData) {
          // Mutación optimista: actualizar caché inmediatamente
          await mutate(
            key,
            async (currentData: TData | undefined) => {
              try {
                const result = await mutationFn(input)
                onSuccess?.(result)
                return revalidate ? undefined : optimisticData(currentData, input)
              } catch (error) {
                onError?.(error instanceof Error ? error : new Error(String(error)))
                throw error
              }
            },
            {
              optimisticData: (currentData: TData | undefined) =>
                optimisticData(currentData, input),
              rollbackOnError,
              revalidate,
            }
          )
        } else {
          // Mutación sin datos optimistas: esperar resultado
          const result = await mutationFn(input)
          onSuccess?.(result)
          if (revalidate && key) {
            await mutate(key)
          }
        }
      } catch (error) {
        if (!optimisticData) {
          onError?.(error instanceof Error ? error : new Error(String(error)))
        }
        throw error
      } finally {
        isMutatingRef.current = false
      }
    },
    [key, mutationFn, mutate, optimisticData, revalidate, rollbackOnError, onSuccess, onError]
  )

  return { trigger, isMutating: isMutatingRef.current }
}
