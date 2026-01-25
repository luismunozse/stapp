import { NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"
import type { PlanWithUsage, CreatePlanInput } from "@/types/superadmin"

// Schema de validación para crear plan
const createPlanSchema = z.object({
  nombre: z.string().min(2, "Nombre debe tener al menos 2 caracteres").max(50),
  tipo: z.enum(["FREE", "PREMIUM"], {
    errorMap: () => ({ message: "Tipo debe ser FREE o PREMIUM" }),
  }),
  descripcion: z.string().max(500).nullable(),
  precio_mensual: z.number().min(0, "Precio mensual debe ser mayor o igual a 0"),
  precio_anual: z.number().min(0, "Precio anual debe ser mayor o igual a 0"),
  moneda: z.string().default("ARS"),
  limite_ordenes: z.number().positive("Límite debe ser positivo").nullable(),
  limite_tecnicos: z.number().positive("Límite debe ser positivo").nullable(),
  limite_clientes: z.number().positive("Límite debe ser positivo").nullable(),
  limite_storage_mb: z.number().positive("Límite debe ser positivo").nullable(),
  features: z.array(z.string()).default([]),
}).refine(
  (data) => {
    // Si es FREE, precios deben ser 0
    if (data.tipo === "FREE") {
      return data.precio_mensual === 0 && data.precio_anual === 0
    }
    return true
  },
  {
    message: "Plan FREE debe tener precios en 0",
    path: ["precio_mensual"],
  }
)

/**
 * GET /api/superadmin/plans
 * Lista todos los planes con información de uso
 */
export async function GET(request: NextRequest) {
  try {
    const { error: authError } = await requireSuperadmin()
    if (authError) return authError

    // Query a la vista plans_with_usage
    const { data: plans, error } = await supabaseAdmin
      .from("plans_with_usage")
      .select("*")
      .order("tipo", { ascending: true })
      .order("precio_mensual", { ascending: true })

    if (error) {
      console.error("Error fetching plans:", error)
      return NextResponse.json(
        { error: "Error al obtener planes" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      plans: plans as PlanWithUsage[],
      total: plans?.length || 0,
    })
  } catch (error) {
    console.error("Error in GET /api/superadmin/plans:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}

/**
 * POST /api/superadmin/plans
 * Crea un nuevo plan
 */
export async function POST(request: NextRequest) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const body = await request.json()

    // Validar con Zod
    const validation = createPlanSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Datos inválidos",
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const data: CreatePlanInput = validation.data

    // Verificar que no exista ya un plan del mismo tipo activo
    const { data: existingPlan } = await supabaseAdmin
      .from("plans")
      .select("id, nombre, tipo")
      .eq("tipo", data.tipo)
      .eq("activo", true)
      .is("deleted_at", null)
      .single()

    if (existingPlan) {
      return NextResponse.json(
        {
          error: `Ya existe un plan ${data.tipo} activo: "${existingPlan.nombre}". Desactívalo primero.`,
        },
        { status: 400 }
      )
    }

    // Configurar el email del superadmin para el trigger de auditoría
    await supabaseAdmin.rpc("set_config", {
      setting: "app.superadmin_email",
      value: email || "system",
    })

    // Crear el plan
    const { data: newPlan, error: createError } = await supabaseAdmin
      .from("plans")
      .insert({
        nombre: data.nombre,
        tipo: data.tipo,
        descripcion: data.descripcion,
        precio_mensual: data.precio_mensual,
        precio_anual: data.precio_anual,
        moneda: data.moneda,
        limite_ordenes: data.limite_ordenes,
        limite_tecnicos: data.limite_tecnicos,
        limite_clientes: data.limite_clientes,
        limite_storage_mb: data.limite_storage_mb,
        features: data.features,
        activo: true,
      })
      .select()
      .single()

    if (createError) {
      console.error("Error creating plan:", createError)
      return NextResponse.json(
        { error: "Error al crear el plan" },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        plan: newPlan,
        message: `Plan "${newPlan.nombre}" creado exitosamente`,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Error in POST /api/superadmin/plans:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}
