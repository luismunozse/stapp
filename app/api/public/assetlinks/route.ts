import { NextResponse } from "next/server"

/**
 * Digital Asset Links — habilita App Links en Android.
 *
 * El AndroidManifest declara `autoVerify="true"` para el host stapp.com.ar, así
 * que al instalar la app Android busca este archivo en
 * `https://stapp.com.ar/.well-known/assetlinks.json` (el rewrite de
 * next.config.js mapea esa ruta acá). Si la huella coincide, los links de
 * stapp.com.ar abren directo en la app; si no, la verificación falla en
 * silencio y los links siguen abriendo en el navegador.
 *
 * ANDROID_CERT_SHA256 = huella SHA-256 del certificado de firma, en mayúsculas
 * y separada por dos puntos. De dónde sacarla:
 *   • Play App Signing (lo normal): Play Console → Release → Setup → App
 *     signing → "SHA-256 certificate fingerprint" del certificado de Google.
 *     Es esa y no la del keystore local: Play re-firma el AAB al distribuir.
 *   • Sideload / APK firmada localmente:
 *       keytool -list -v -keystore android/stapp-release.jks -alias stapp
 *
 * Se aceptan varias huellas separadas por coma, para convivir la del keystore
 * de sideload con la de Play durante la transición.
 */

const PACKAGE_NAME = "ar.com.stapp.app"
const SHA256_RE = /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/

function getFingerprints(): string[] {
  const raw = process.env.ANDROID_CERT_SHA256
  if (!raw) return []
  return raw
    .split(",")
    .map((fp) => fp.trim().toUpperCase())
    .filter((fp) => SHA256_RE.test(fp))
}

export async function GET() {
  const fingerprints = getFingerprints()

  // Sin huellas configuradas devolvemos una lista vacía y no cacheamos: Android
  // reintenta la verificación y la toma apenas se setea la env var, sin deploy.
  if (fingerprints.length === 0) {
    return NextResponse.json([], {
      headers: { "Cache-Control": "no-store" },
    })
  }

  return NextResponse.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: PACKAGE_NAME,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
    {
      headers: { "Cache-Control": "public, max-age=3600" },
    }
  )
}
