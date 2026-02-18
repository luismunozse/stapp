#!/usr/bin/env node

/**
 * Script para subir el APK a Supabase Storage
 * Uso: node scripts/upload-apk.mjs
 *
 * Requiere las variables de entorno:
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js"
import { readFileSync, statSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, "..")

// Cargar variables de entorno (.env.local o .env)
const envLocalPath = resolve(projectRoot, ".env.local")
const envPath = existsSync(envLocalPath)
  ? envLocalPath
  : resolve(projectRoot, ".env")
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8")
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIndex = trimmed.indexOf("=")
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()
    // Quitar comillas si las tiene
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = "apk-releases"
const APK_PATH = resolve(projectRoot, "android/app/build/outputs/apk/debug/app-debug.apk")

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Error: Faltan variables de entorno NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

if (!existsSync(APK_PATH)) {
  console.error(`Error: No se encontró el APK en ${APK_PATH}`)
  console.error("Ejecutá primero: npm run cap:build:apk")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function ensureBucket() {
  const { data: buckets } = await supabase.storage.listBuckets()
  const exists = buckets?.some((b) => b.name === BUCKET)

  if (!exists) {
    console.log(`Creando bucket "${BUCKET}"...`)
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: true,
    })
    if (error) {
      console.error("Error creando bucket:", error.message)
      process.exit(1)
    }
    console.log("Bucket creado exitosamente")
  }
}

async function uploadApk() {
  const stats = statSync(APK_PATH)
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2)
  console.log(`Subiendo APK (${fileSizeMB} MB)...`)

  const fileBuffer = readFileSync(APK_PATH)

  // Subir APK como stapp-latest.apk (siempre sobreescribe)
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload("stapp-latest.apk", fileBuffer, {
      contentType: "application/vnd.android.package-archive",
      upsert: true,
    })

  if (error) {
    console.error("Error subiendo APK:", error.message)
    process.exit(1)
  }

  // Subir metadata con fecha de build
  const metadata = {
    version: "1.0.0",
    buildDate: new Date().toISOString(),
    fileName: "stapp-latest.apk",
    fileSize: stats.size,
    fileSizeMB: `${fileSizeMB} MB`,
  }

  await supabase.storage
    .from(BUCKET)
    .upload("metadata.json", JSON.stringify(metadata, null, 2), {
      contentType: "application/json",
      upsert: true,
    })

  // Obtener URL pública
  const { data } = supabase.storage.from(BUCKET).getPublicUrl("stapp-latest.apk")

  console.log("\nAPK subido exitosamente!")
  console.log(`URL de descarga: ${data.publicUrl}`)
  console.log(`Tamaño: ${fileSizeMB} MB`)
  console.log(`Fecha: ${metadata.buildDate}`)
}

async function main() {
  try {
    await ensureBucket()
    await uploadApk()
  } catch (err) {
    console.error("Error:", err.message)
    process.exit(1)
  }
}

main()
