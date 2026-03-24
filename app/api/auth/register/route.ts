import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"
import crypto from "crypto"
import { z } from "zod"
import { isValidSlug, RESERVED_SUBDOMAINS } from "@/lib/tenant"
import { sendVerificationEmail } from "@/lib/email"
import { verifyGoogleIdToken } from "@/lib/google"

// Schema de validación (password opcional para Google)
const registerSchema = z.object({
  // Datos de la organización
  organizacion: z.object({
    nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
    slug: z.string().min(3, "El subdominio debe tener al menos 3 caracteres").max(50),
    telefono: z.string().optional(),
    email: z.string().email("Email inválido").optional().or(z.literal("")),
    direccion: z.string().optional(),
  }),
  // Datos del usuario admin (nombre y email pueden estar vacíos si hay googleIdToken)
  usuario: z.object({
    nombre: z.string().default(""),
    email: z.string().default(""),
    password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres").optional(),
  }),
  // Google ID Token (opcional, para registro con Google)
  googleIdToken: z.string().optional(),
})

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

    const { organizacion, usuario, googleIdToken } = validationResult.data

    // Determinar si es registro con Google
    const isGoogleRegister = !!googleIdToken
    let googleEmail: string | null = null
    let googleName: string | null = null

    if (isGoogleRegister) {
      // Verificar el token de Google
      try {
        const googleUser = await verifyGoogleIdToken(googleIdToken)
        googleEmail = googleUser.email
        googleName = googleUser.name
      } catch {
        return NextResponse.json(
          { error: "Token de Google inválido. Intentá de nuevo." },
          { status: 400 }
        )
      }
    } else {
      // Registro tradicional: validar campos obligatorios
      if (!usuario.nombre || usuario.nombre.length < 2) {
        return NextResponse.json(
          { error: "El nombre debe tener al menos 2 caracteres" },
          { status: 400 }
        )
      }
      if (!usuario.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(usuario.email)) {
        return NextResponse.json(
          { error: "Email inválido" },
          { status: 400 }
        )
      }
      if (!usuario.password) {
        return NextResponse.json(
          { error: "La contraseña es requerida" },
          { status: 400 }
        )
      }
    }

    // Para Google, usar el email verificado por Google
    const userEmail = isGoogleRegister ? googleEmail! : usuario.email
    const userName = isGoogleRegister ? (usuario.nombre || googleName!) : usuario.nombre

    // Validar formato del slug
    const slugValidation = isValidSlug(organizacion.slug)
    if (!slugValidation.valid) {
      return NextResponse.json(
        { error: slugValidation.error || "Subdominio inválido" },
        { status: 400 }
      )
    }

    // Verificar que el slug no sea reservado
    if (RESERVED_SUBDOMAINS.has(organizacion.slug.toLowerCase())) {
      return NextResponse.json(
        { error: "Este subdominio está reservado" },
        { status: 400 }
      )
    }

    // Verificar que el email del usuario no exista
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", userEmail)
      .single()

    if (existingUser) {
      return NextResponse.json(
        { error: "Ya existe una cuenta con este email" },
        { status: 400 }
      )
    }

    // Verificar que el slug no exista
    const { data: existingOrg } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .eq("slug", organizacion.slug)
      .single()

    if (existingOrg) {
      return NextResponse.json(
        { error: "Este subdominio ya está en uso" },
        { status: 400 }
      )
    }

    const slug = organizacion.slug

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

    // Hash de la contraseña (null para Google)
    const hashedPassword = usuario.password
      ? await bcrypt.hash(usuario.password, 10)
      : null

    // Para Google, email ya está verificado. Para credentials, generar token de verificación
    const verificationToken = isGoogleRegister ? null : crypto.randomBytes(32).toString("hex")
    const verificationExpires = isGoogleRegister ? null : new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 horas

    // Crear el usuario admin
    const { data: newUser, error: userError } = await supabaseAdmin
      .from("users")
      .insert({
        email: userEmail,
        password: hashedPassword,
        nombre: userName,
        rol: "ADMIN",
        organization_id: newOrg.id,
        email_verified: isGoogleRegister, // Google = ya verificado
        email_verification_token: verificationToken,
        email_verification_expires: verificationExpires?.toISOString() || null,
        provider: isGoogleRegister ? "google" : "credentials",
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
    }

    // Crear progreso de onboarding
    const { error: onboardingError } = await supabaseAdmin
      .from("onboarding_progress")
      .insert({ organization_id: newOrg.id })
    if (onboardingError) {
      console.error("Error creating onboarding progress:", onboardingError)
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

    // Enviar email de verificación (solo para registro con credentials)
    if (!isGoogleRegister && verificationToken) {
      try {
        await sendVerificationEmail({
          email: userEmail,
          token: verificationToken,
          nombre: userName,
          slug: newOrg.slug,
        })
      } catch (emailError) {
        console.error("Error sending verification email:", emailError)
        // No hacemos rollback, el usuario puede solicitar reenvío
      }
    }

    return NextResponse.json({
      success: true,
      message: isGoogleRegister
        ? "Cuenta creada exitosamente."
        : "Cuenta creada. Revisá tu email para verificar tu cuenta.",
      requiresVerification: !isGoogleRegister,
      provider: isGoogleRegister ? "google" : "credentials",
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
