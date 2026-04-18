#!/usr/bin/env node
/**
 * Enable 2FA for a superadmin user.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/setup-superadmin-2fa.mjs <email>
 *
 * Requires env vars: NEXTAUTH_SECRET, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * The script generates a TOTP secret, encrypts it with the same algorithm as
 * lib/totp.ts (AES-256-GCM, key = SHA256(NEXTAUTH_SECRET)), saves it plus
 * hashed backup codes to the users row, and prints the otpauth URI, an ASCII
 * QR code, and the plaintext backup codes for one-time display.
 */

import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import bcrypt from "bcryptjs"
import * as OTPAuth from "otpauth"
import QRCode from "qrcode"

const ALGORITHM = "aes-256-gcm"
const ISSUER = "STApp"

function die(msg) {
  console.error(`ERROR: ${msg}`)
  process.exit(1)
}

const email = process.argv[2]
if (!email) die("Missing email argument. Usage: setup-superadmin-2fa.mjs <email>")

const { NEXTAUTH_SECRET, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!NEXTAUTH_SECRET) die("NEXTAUTH_SECRET not set")
if (!NEXT_PUBLIC_SUPABASE_URL) die("NEXT_PUBLIC_SUPABASE_URL not set")
if (!SUPABASE_SERVICE_ROLE_KEY) die("SUPABASE_SERVICE_ROLE_KEY not set")

function encryptSecret(plaintext) {
  const key = createHash("sha256").update(NEXTAUTH_SECRET).digest()
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(plaintext, "utf8", "hex")
  encrypted += cipher.final("hex")
  const authTag = cipher.getAuthTag().toString("hex")
  return `${iv.toString("hex")}:${authTag}:${encrypted}`
}

function generateBackupCodes() {
  return Array.from({ length: 10 }, () => randomBytes(4).toString("hex").toUpperCase())
}

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const { data: user, error: findErr } = await supabase
  .from("users")
  .select("id, email, totp_enabled")
  .eq("email", email)
  .single()

if (findErr || !user) die(`User ${email} not found (${findErr?.message || "no row"})`)

if (user.totp_enabled) {
  console.log(`\n⚠  ${email} already has 2FA enabled.`)
  console.log("If you lost the authenticator, re-run with --force to overwrite.\n")
  if (!process.argv.includes("--force")) process.exit(0)
}

const totp = new OTPAuth.TOTP({
  issuer: ISSUER,
  label: email,
  algorithm: "SHA1",
  digits: 6,
  period: 30,
})
const secretBase32 = totp.secret.base32
const uri = totp.toString()

const encrypted = encryptSecret(secretBase32)
const plainBackupCodes = generateBackupCodes()
const hashedBackupCodes = await Promise.all(plainBackupCodes.map((c) => bcrypt.hash(c, 10)))

const { error: updateErr } = await supabase
  .from("users")
  .update({
    totp_enabled: true,
    totp_secret: encrypted,
    totp_backup_codes: hashedBackupCodes,
  })
  .eq("id", user.id)

if (updateErr) die(`Failed to update user: ${updateErr.message}`)

const qrAscii = await QRCode.toString(uri, { type: "terminal", small: true })

console.log("\n==============================================================")
console.log(` 2FA enabled for: ${email}`)
console.log("==============================================================\n")
console.log("Scan this QR with Google Authenticator / Authy / 1Password:\n")
console.log(qrAscii)
console.log("Or enter this secret manually in the app:")
console.log(`  ${secretBase32}\n`)
console.log("Or open this URI:")
console.log(`  ${uri}\n`)
console.log("--------------------------------------------------------------")
console.log(" BACKUP CODES (save now — shown only this once):")
console.log("--------------------------------------------------------------")
plainBackupCodes.forEach((c) => console.log(`  ${c}`))
console.log("\nDone. Log in at https://admin.stapp.com.ar/superadmin-login")
console.log("with email + password + a 6-digit code from the app.\n")
