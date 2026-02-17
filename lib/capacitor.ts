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
