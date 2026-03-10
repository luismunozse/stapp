import { NextResponse } from "next/server"
import { z } from "zod"

/**
 * Clamps pagination parameters to safe defaults.
 * Max limit is 100 to prevent abuse.
 */
export function parsePagination(searchParams: URLSearchParams, defaults?: { limit?: number }) {
  const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1)
  const rawLimit = parseInt(searchParams.get("limit") || String(defaults?.limit ?? 20)) || 20
  const limit = Math.min(Math.max(1, rawLimit), 100)
  const offset = (page - 1) * limit
  return { page, limit, offset }
}

/**
 * Safely parses request.json() with error handling.
 * Returns parsed body or a 400 NextResponse.
 */
export async function safeParseBody<T extends z.ZodType>(
  request: Request,
  schema: T
): Promise<{ data: z.infer<T> } | { error: NextResponse }> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return {
      error: NextResponse.json(
        { error: "El cuerpo de la solicitud debe ser JSON válido" },
        { status: 400 }
      ),
    }
  }

  const result = schema.safeParse(body)
  if (!result.success) {
    return {
      error: NextResponse.json(
        {
          error: "Datos inválidos",
          details: result.error.flatten().fieldErrors,
        },
        { status: 400 }
      ),
    }
  }

  return { data: result.data }
}
