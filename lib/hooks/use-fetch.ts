import useSWR, { SWRConfiguration } from "swr"

// Fetcher genérico con manejo de errores
const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const error = new Error("Error al cargar datos")
    throw error
  }
  return res.json()
}

// Configuración por defecto optimizada
const defaultConfig: SWRConfiguration = {
  revalidateOnFocus: false, // No revalidar al enfocar ventana
  revalidateOnReconnect: true,
  dedupingInterval: 5000, // Deduplicar requests en 5 segundos
  errorRetryCount: 2,
}

interface UseFetchOptions<T> extends SWRConfiguration<T> {
  enabled?: boolean
}

/**
 * Hook para fetching con caché usando SWR
 * @param url - URL del endpoint (null para deshabilitar)
 * @param options - Opciones de SWR
 */
export function useFetch<T>(
  url: string | null,
  options: UseFetchOptions<T> = {}
) {
  const { enabled = true, ...swrOptions } = options

  const { data, error, isLoading, isValidating, mutate } = useSWR<T>(
    enabled && url ? url : null,
    fetcher,
    {
      ...defaultConfig,
      ...swrOptions,
    }
  )

  return {
    data,
    error,
    isLoading,
    isValidating,
    mutate,
    // Helpers
    isEmpty: !isLoading && !data,
    isError: !!error,
  }
}

/**
 * Hook para listas paginadas con caché
 */
interface PaginatedData<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

interface UsePaginatedListOptions {
  page?: number
  limit?: number
  search?: string
  filters?: Record<string, string>
  sortBy?: string
  sortOrder?: "asc" | "desc"
  enabled?: boolean
}

export function usePaginatedList<T>(
  baseUrl: string,
  options: UsePaginatedListOptions = {}
) {
  const {
    page = 1,
    limit = 20,
    search = "",
    filters = {},
    sortBy,
    sortOrder,
    enabled = true,
  } = options

  // Construir URL con parámetros
  const params = new URLSearchParams()
  params.set("page", page.toString())
  params.set("limit", limit.toString())

  if (search) params.set("search", search)
  if (sortBy) params.set("sortBy", sortBy)
  if (sortOrder) params.set("sortOrder", sortOrder)

  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value)
  })

  const url = `${baseUrl}?${params.toString()}`

  const { data, error, isLoading, isValidating, mutate } = useSWR<PaginatedData<T>>(
    enabled ? url : null,
    fetcher,
    {
      ...defaultConfig,
      keepPreviousData: true, // Mantener datos previos mientras carga
    }
  )

  return {
    items: data?.data || [],
    total: data?.total || 0,
    totalPages: data?.totalPages || 0,
    currentPage: data?.page || page,
    isLoading,
    isValidating,
    error,
    mutate,
    // Refresh data
    refresh: () => mutate(),
  }
}
