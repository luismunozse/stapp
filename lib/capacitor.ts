import { Capacitor } from '@capacitor/core'

/**
 * Detecta si la app corre dentro de Capacitor (Android/iOS)
 */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform()
}

/**
 * Retorna la plataforma actual: 'android' | 'ios' | 'web'
 */
export function getPlatform(): string {
  return Capacitor.getPlatform()
}

/**
 * Sincroniza el StatusBar nativo con el tema actual (dark/light).
 * No-op en web. Falla silenciosamente si el plugin no está disponible.
 */
export async function syncStatusBarToTheme(isDark: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    // Style.Light => texto/iconos claros (para fondos oscuros)
    // Style.Dark  => texto/iconos oscuros (para fondos claros)
    await StatusBar.setStyle({ style: isDark ? Style.Light : Style.Dark })
    await StatusBar.setBackgroundColor({ color: isDark ? '#0a0a1a' : '#ffffff' })
  } catch {
    /* plugin not available */
  }
}

/**
 * Oculta el splash screen nativo. Debe llamarse cuando la app está lista
 * para ser interactiva. No-op en web.
 */
export async function hideSplashScreen(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide()
  } catch {
    /* plugin not available */
  }
}
