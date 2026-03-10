"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { toast } from "sonner"

interface UseSuperadminFetchOptions {
  /** Show toast on error (default: true) */
  showErrorToast?: boolean
  /** Show toast on success for mutations (default: true) */
  showSuccessToast?: boolean
}

interface FetchState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

/**
 * Hook for standardized superadmin API calls with:
 * - Automatic AbortController for cleanup
 * - Toast notifications for errors and successes
 * - Loading state management
 * - Type-safe responses
 */
export function useSuperadminFetch<T>(
  options: UseSuperadminFetchOptions = {}
) {
  const { showErrorToast = true, showSuccessToast = true } = options
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: false,
    error: null,
  })
  const abortControllerRef = useRef<AbortController | null>(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const fetchData = useCallback(
    async (
      url: string,
      fetchOptions?: RequestInit & { successMessage?: string }
    ): Promise<T | null> => {
      // Abort previous request
      abortControllerRef.current?.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller

      setState((prev) => ({ ...prev, loading: true, error: null }))

      try {
        const { successMessage, ...restOptions } = fetchOptions || {}
        const res = await fetch(url, {
          ...restOptions,
          signal: controller.signal,
        })

        const data = await res.json()

        if (!res.ok) {
          const errorMsg = data.error || `Error (${res.status})`
          setState({ data: null, loading: false, error: errorMsg })
          if (showErrorToast) {
            toast.error(errorMsg)
          }
          return null
        }

        setState({ data, loading: false, error: null })

        if (successMessage && showSuccessToast) {
          toast.success(successMessage)
        }

        return data
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
          return null
        }
        const errorMsg =
          error instanceof Error ? error.message : "Error de conexión"
        setState({ data: null, loading: false, error: errorMsg })
        if (showErrorToast) {
          toast.error(errorMsg)
        }
        return null
      }
    },
    [showErrorToast, showSuccessToast]
  )

  const reset = useCallback(() => {
    abortControllerRef.current?.abort()
    setState({ data: null, loading: false, error: null })
  }, [])

  return {
    ...state,
    fetchData,
    reset,
  }
}

/**
 * Hook for superadmin mutations (POST, PUT, PATCH, DELETE) with:
 * - Loading state per mutation
 * - Toast feedback
 * - Optional callback on success
 */
export function useSuperadminMutation<TResponse = unknown>() {
  const [loading, setLoading] = useState(false)

  const mutate = useCallback(
    async (
      url: string,
      options: {
        method: "POST" | "PUT" | "PATCH" | "DELETE"
        body?: unknown
        successMessage?: string
        errorMessage?: string
        onSuccess?: (data: TResponse) => void
      }
    ): Promise<TResponse | null> => {
      setLoading(true)
      try {
        const res = await fetch(url, {
          method: options.method,
          headers: { "Content-Type": "application/json" },
          ...(options.body !== undefined && {
            body: JSON.stringify(options.body),
          }),
        })

        const data = await res.json()

        if (!res.ok) {
          toast.error(
            data.error || options.errorMessage || `Error (${res.status})`
          )
          return null
        }

        if (options.successMessage) {
          toast.success(data.message || options.successMessage)
        }

        options.onSuccess?.(data)
        return data
      } catch (error: unknown) {
        const msg =
          error instanceof Error ? error.message : "Error de conexión"
        toast.error(options.errorMessage || msg)
        return null
      } finally {
        setLoading(false)
      }
    },
    []
  )

  return { mutate, loading }
}
