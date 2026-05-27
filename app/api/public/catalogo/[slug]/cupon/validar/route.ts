import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"
import { isValidSlug, isValidCuponCodigo } from "@/lib/catalogo-validators"
import { rateLimit } from "@/lib/rate-limit"

const schema = z.object({
  codigo: z.string().min(3).max(32),
  subtotal: z.number().positive(),
})

// Respuesta uniforme para todos los casos de error. La RPC devuelve mensajes
// discriminantes ("no encontrado" / "inactivo" / "vencido" / "agotado" /
// "min_compra") que permitirían enumerar códigos de cupón válidos. El error
// específico solo se devuelve cuando el cliente envía cotización real
// (/cotizar), donde queda registro y el brute-force es costoso.
const ERROR_RESP = { ok: false as const, error: "Cupón no válido" }

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  if (!isValidSlug(slug)) {
    return NextResponse.json({ ok: false, error: "Slug inválido" }, { status: 400 })
  }

  // Rate limit dedicado anti brute-force: 5/min por (IP, slug). Más estricto
  // que el del middleware (20/min). Detiene enumeración de cupones desde una
  // sola IP, incluso si rotan códigos.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await rateLimit(`cupval:${ip}:${slug}`, 5, 60_000)
  if (!rl.success) {
    return NextResponse.json(
      { ok: false, error: "Demasiadas validaciones. Esperá un minuto." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rl.reset - Date.now()) / 1000)),
          "X-RateLimit-Limit": String(rl.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(rl.reset),
        },
      }
    )
  }

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json(ERROR_RESP, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success || !isValidCuponCodigo(parsed.data.codigo)) {
    return NextResponse.json(ERROR_RESP, { status: 400 })
  }

  const { data: config } = await supabaseAdmin
    .from("catalogo_config")
    .select("organization_id, activo")
    .eq("slug", slug)
    .maybeSingle()

  if (!config || !config.activo) {
    return NextResponse.json({ ok: false, error: "Catálogo no disponible" }, { status: 404 })
  }

  const { data: result, error } = await supabaseAdmin.rpc("validar_cupon_catalogo", {
    p_organization_id: config.organization_id,
    p_codigo: parsed.data.codigo.toUpperCase(),
    p_subtotal: parsed.data.subtotal,
  })

  if (error) {
    console.error("Error validando cupón:", error)
    return NextResponse.json(ERROR_RESP, { status: 500 })
  }

  // Si la RPC devuelve ok:false (cualquier razón), normalizamos al mensaje
  // genérico. Si ok:true devolvemos el descuento calculado.
  const ok = (result as { ok?: boolean } | null)?.ok === true
  if (!ok) {
    return NextResponse.json(ERROR_RESP)
  }
  return NextResponse.json(result)
}
