import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"
import { z } from "zod"

// Schema de validación
const registerSchema = z.object({
  // Datos de la organización
  organizacion: z.object({
    nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
    telefono: z.string().optional(),
    email: z.string().email("Email inválido").optional().or(z.literal("")),
    direccion: z.string().optional(),
  }),
  // Datos del usuario admin
  usuario: z.object({
    nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
    email: z.string().email("Email inválido"),
    password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
  }),
})

// Función para generar slug único
function generateSlug(nombre: string): string {
  const baseSlug = nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Eliminar acentos
    .replace(/[^a-z0-9]+/g, "-") // Reemplazar caracteres especiales
    .replace(/^-+|-+$/g, "") // Eliminar guiones al inicio/final
    .substring(0, 50)

  // Añadir sufijo aleatorio para unicidad
  const randomSuffix = Math.random().toString(36).substring(2, 6)
  return `${baseSlug}-${randomSuffix}`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validar datos
    const validationResult = registerSchema.safeParse(body)
    if (!validationResult.success) {
      const errors = validationResult.error.errors.map((e) => e.message)
      return NextResponse.json(
        { error: errors.join(", ") },
        { status: 400 }
      )
    }

    const { organizacion, usuario } = validationResult.data

    // Verificar que el email del usuario no exista
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", usuario.email)
      .single()

    if (existingUser) {
      return NextResponse.json(
        { error: "Ya existe una cuenta con este email" },
        { status: 400 }
      )
    }

    // Generar slug único para la organización
    let slug = generateSlug(organizacion.nombre)

    // Verificar que el slug no exista (por si acaso)
    const { data: existingOrg } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .single()

    if (existingOrg) {
      // Generar otro slug si existe colisión sin modificar el nombre original
      slug = generateSlug(organizacion.nombre)
    }

    // Crear la organización
    const { data: newOrg, error: orgError } = await supabaseAdmin
      .from("organizations")
      .insert({
        nombre: organizacion.nombre,
        slug: slug,
        email: organizacion.email || null,
        telefono: organizacion.telefono || null,
        direccion: organizacion.direccion || null,
        activo: true,
        nombre_mostrar: organizacion.nombre,
        notificaciones_email: true,
        notificaciones_whatsapp: false,
        dias_recordatorio: 3,
      })
      .select()
      .single()

    if (orgError || !newOrg) {
      console.error("Error creating organization:", orgError)
      return NextResponse.json(
        { error: "Error al crear la organización" },
        { status: 500 }
      )
    }

    // Hash de la contraseña
    const hashedPassword = await bcrypt.hash(usuario.password, 10)

    // Crear el usuario admin
    const { data: newUser, error: userError } = await supabaseAdmin
      .from("users")
      .insert({
        email: usuario.email,
        password: hashedPassword,
        nombre: usuario.nombre,
        rol: "ADMIN",
        organization_id: newOrg.id,
      })
      .select("id, email, nombre, rol")
      .single()

    if (userError || !newUser) {
      console.error("Error creating user:", userError)
      // Rollback: eliminar la organización creada
      await supabaseAdmin.from("organizations").delete().eq("id", newOrg.id)
      return NextResponse.json(
        { error: "Error al crear el usuario" },
        { status: 500 }
      )
    }

    // Crear los contadores de la organización
    const { error: countersError } = await supabaseAdmin
      .from("organization_counters")
      .insert({
        organization_id: newOrg.id,
        next_order_number: 1,
        next_quote_number: 1,
        next_invoice_number: 1,
      })

    if (countersError) {
      console.error("Error creating counters:", countersError)
      // No hacemos rollback completo, los contadores se crearán cuando se necesiten
    }

    // Crear template de checklist por defecto
    const { data: template } = await supabaseAdmin
      .from("checklist_templates")
      .insert({
        organization_id: newOrg.id,
        nombre: "Checklist de Recepción",
        activo: true,
      })
      .select()
      .single()

    // Agregar items por defecto al template
    if (template) {
      await supabaseAdmin.from("checklist_template_items").insert([
        {
          template_id: template.id,
          label: "Pantalla en buen estado",
          tipo: "BOOLEAN",
          categoria: "CONDICION_FISICA",
          orden: 0,
          requerido: true,
        },
        {
          template_id: template.id,
          label: "Carcasa sin daños",
          tipo: "BOOLEAN",
          categoria: "CONDICION_FISICA",
          orden: 1,
          requerido: true,
        },
        {
          template_id: template.id,
          label: "Botones funcionan",
          tipo: "BOOLEAN",
          categoria: "FUNCIONAL",
          orden: 2,
          requerido: true,
        },
        {
          template_id: template.id,
          label: "Cargador incluido",
          tipo: "BOOLEAN",
          categoria: "ACCESORIOS",
          orden: 3,
          requerido: false,
        },
        {
          template_id: template.id,
          label: "Observaciones adicionales",
          tipo: "TEXT",
          categoria: "OTRO",
          orden: 4,
          requerido: false,
        },
      ])
    }

    return NextResponse.json({
      success: true,
      message: "Organización creada exitosamente",
      organization: {
        id: newOrg.id,
        nombre: newOrg.nombre,
        slug: newOrg.slug,
      },
      user: {
        id: newUser.id,
        email: newUser.email,
        nombre: newUser.nombre,
      },
    })
  } catch (error) {
    console.error("Register error:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}
