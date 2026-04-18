import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import {
  generateTOTPSecret,
  encryptSecret,
  generateBackupCodes,
  hashBackupCodes,
} from "@/lib/totp"
import QRCode from "qrcode"

// One-shot endpoint to enable 2FA for a superadmin account without being able
// to log in (chicken-and-egg: SUPERADMIN_REQUIRES_2FA_SETUP blocks login).
// Runs on Vercel so encryption uses the production NEXTAUTH_SECRET.
//
// Usage: POST /api/bootstrap-2fa with body { email, token } where token matches
// env ADMIN_2FA_BOOTSTRAP_TOKEN (set this in Vercel just for this operation and
// remove right after). The endpoint 404s if the env var isn't set, so there's
// nothing to attack when not in use.
export async function POST(request: Request) {
  const bootstrapToken = process.env.ADMIN_2FA_BOOTSTRAP_TOKEN
  if (!bootstrapToken) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  let body: { email?: string; token?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { email, token } = body
  if (!email || !token) {
    return NextResponse.json(
      { error: "email and token are required" },
      { status: 400 }
    )
  }

  if (token !== bootstrapToken) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  const superadminEmails =
    process.env.SUPERADMIN_EMAILS?.split(",").map((e) => e.trim().toLowerCase()) || []
  if (!superadminEmails.includes(email.toLowerCase())) {
    return NextResponse.json(
      { error: "Email is not in SUPERADMIN_EMAILS" },
      { status: 403 }
    )
  }

  const { data: user, error: userErr } = await supabaseAdmin
    .from("users")
    .select("id, email")
    .eq("email", email)
    .single()

  if (userErr || !user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const { secret, uri } = generateTOTPSecret(user.email)
  const encrypted = encryptSecret(secret)
  const backupCodes = generateBackupCodes()
  const hashed = await hashBackupCodes(backupCodes)

  const { error: updateErr } = await supabaseAdmin
    .from("users")
    .update({
      totp_enabled: true,
      totp_secret: encrypted,
      totp_backup_codes: hashed,
    })
    .eq("id", user.id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  const qrDataUrl = await QRCode.toDataURL(uri)

  return NextResponse.json({
    ok: true,
    email: user.email,
    secret,
    uri,
    qrDataUrl,
    backupCodes,
    note: "Escaneá el QR con una app TOTP y guardá los backup codes. Desactivá ADMIN_2FA_BOOTSTRAP_TOKEN en Vercel ahora.",
  })
}
