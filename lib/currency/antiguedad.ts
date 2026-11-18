/** How long ago `en` was, short and in Spanish: "instantes", "12 min", "3 h", "2 d". */
export function antiguedad(en: string, ahora: Date = new Date()): string {
  const minutos = Math.max(0, Math.floor((ahora.getTime() - new Date(en).getTime()) / 60_000))
  if (minutos < 1) return "instantes"
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `${horas} h`
  return `${Math.floor(horas / 24)} d`
}
