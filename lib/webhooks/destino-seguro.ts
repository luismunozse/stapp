import { promises as dns } from "node:dns"
import { BlockList, isIP } from "node:net"

// Webhooks salientes: el destino lo elige el admin de cada taller, y el envío
// sale desde nuestro servidor. Sin este filtro podría apuntar a la red interna
// (p. ej. la Runtime API de Lambda en 127.0.0.1:9001, metadata en
// 169.254.169.254) y ver la respuesta en el test o en el log de entregas.

const internas = new BlockList()
for (const [red, bits] of [
  ["0.0.0.0", 8],        // "esta" red
  ["10.0.0.0", 8],       // privada
  ["100.64.0.0", 10],    // CGNAT
  ["127.0.0.0", 8],      // loopback
  ["169.254.0.0", 16],   // link-local / metadata
  ["172.16.0.0", 12],    // privada
  ["192.0.0.0", 24],     // asignaciones IETF
  ["192.168.0.0", 16],   // privada
  ["198.18.0.0", 15],    // benchmarking
  ["224.0.0.0", 4],      // multicast
  ["240.0.0.0", 4],      // reservada + broadcast
] as const) internas.addSubnet(red, bits, "ipv4")
for (const [red, bits] of [
  ["::", 128],           // no especificada
  ["::1", 128],          // loopback
  ["fc00::", 7],         // ULA
  ["fe80::", 10],        // link-local
  ["ff00::", 8],         // multicast
] as const) internas.addSubnet(red, bits, "ipv6")

/** true si la IP es de una red interna/reservada (o si no es una IP válida). */
export function esIpInterna(ip: string): boolean {
  const familia = isIP(ip)
  if (familia === 4) return internas.check(ip, "ipv4")
  if (familia === 6) {
    // IPv4 mapeada (::ffff:a.b.c.d): se juzga por la IPv4.
    const mapeada = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapeada) return internas.check(mapeada[1], "ipv4")
    return internas.check(ip, "ipv6")
  }
  return true
}

export type DestinoWebhook = { ok: true } | { ok: false; error: string }

/**
 * Valida que una URL de webhook sea HTTPS y apunte solo a IPs públicas.
 * Resuelve el DNS: si alguna de las direcciones es interna, se rechaza.
 * Queda una ventana de DNS rebinding entre esta resolución y la del fetch;
 * el dispatcher además no sigue redirects.
 */
export async function validarDestinoWebhook(url: string): Promise<DestinoWebhook> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { ok: false, error: "URL inválida" }
  }
  if (u.protocol !== "https:") return { ok: false, error: "La URL debe ser HTTPS" }

  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (!host) return { ok: false, error: "URL inválida" }

  if (isIP(host)) {
    return esIpInterna(host)
      ? { ok: false, error: "La URL apunta a una red interna" }
      : { ok: true }
  }

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, error: "La URL apunta a una red interna" }
  }

  let direcciones: { address: string }[]
  try {
    direcciones = await dns.lookup(host, { all: true, verbatim: true })
  } catch {
    return { ok: false, error: "No se pudo resolver el dominio de la URL" }
  }
  if (direcciones.length === 0) return { ok: false, error: "No se pudo resolver el dominio de la URL" }
  if (direcciones.some((d) => esIpInterna(d.address))) {
    return { ok: false, error: "La URL apunta a una red interna" }
  }
  return { ok: true }
}
