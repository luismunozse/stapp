const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 10

const buckets = new Map<string, { count: number; resetTime: number }>()

export function checkAsistenteRateLimit(key: string, now: number = Date.now()): boolean {
  const bucket = buckets.get(key)
  if (!bucket || now > bucket.resetTime) {
    buckets.set(key, { count: 1, resetTime: now + WINDOW_MS })
    return true
  }
  if (bucket.count >= MAX_PER_WINDOW) return false
  bucket.count++
  return true
}
