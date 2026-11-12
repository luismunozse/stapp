/** "≈ " cuando la valuación incluye ítems convertidos desde una divisa. */
export function prefijoAprox(aproximado?: boolean): string {
  return aproximado ? "≈ " : ""
}

export function textoExcluidos(n: number): string {
  return n === 1
    ? "1 producto en divisa sin cotización no se incluye"
    : `${n} productos en divisa sin cotización no se incluyen`
}

/** Aviso de ítems en divisa que quedaron fuera de la valuación por no tener equivalente local. */
export function AvisoExcluidos({ n, className = "" }: { n?: number; className?: string }) {
  if (!n || n <= 0) return null
  return <p className={`text-xs text-amber-600 ${className}`}>{textoExcluidos(n)}</p>
}
