import { describe, expect, it } from 'vitest'
import config from '../capacitor.config'

describe('capacitor.config', () => {
  it('loads the canonical apex host', () => {
    const url = new URL(config.server?.url ?? '')
    expect(url.protocol).toBe('https:')
    expect(url.host).toBe('stapp.com.ar')
    expect(url.pathname).toBe('/app-entry')
  })

  it('keeps the server.url host inside allowNavigation', () => {
    expect(config.server?.allowNavigation).toContain('*.stapp.com.ar')
  })

  // The web calls SplashScreen.hide() once React mounts. If the native bridge
  // never reaches the page (old WebView, network error, redirect to a host
  // without the bridge), that call never happens: the splash must still close.
  it('auto-hides the splash screen after a bounded delay as a fallback', () => {
    const splash = config.plugins?.SplashScreen as
      | { launchAutoHide?: boolean; launchShowDuration?: number }
      | undefined
    expect(splash?.launchAutoHide).toBe(true)
    expect(splash?.launchShowDuration).toBeGreaterThanOrEqual(3000)
    expect(splash?.launchShowDuration).toBeLessThanOrEqual(8000)
  })
})
