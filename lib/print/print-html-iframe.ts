// ============================================
// IMPRESIÓN VÍA DRIVER (iframe oculto)
// ============================================
// Mismo mecanismo robusto que el comprobante térmico: render a un iframe oculto,
// esperar imágenes (QR), y disparar el print del driver. Más confiable que
// window.open y compatible con cualquier impresora que tenga driver en el SO.

/**
 * Tope de espera para que una imagen (el QR) termine de cargar antes de
 * imprimir igual, y tope de espera para que el iframe dispare `onload` antes
 * de imprimir igual. El QR es un data URI: en la practica ambas esperas
 * resuelven casi instantaneo. Si alguna no lo hace, imprimir con el QR sin
 * pintar (o disparar el print apenas se puede) es un resultado muchisimo
 * mejor que congelar el mostrador: el operador puede reimprimir una
 * etiqueta: no puede recuperarse de un modal trabado en medio de un lote.
 * No "arreglar" esto de vuelta a una espera sin limite.
 */
const IMAGE_LOAD_TIMEOUT_MS = 3000
const IFRAME_LOAD_TIMEOUT_MS = 3000

/**
 * Espera `promise`, pero nunca mas de `timeoutMs`. Si el timeout gana, avisa
 * por consola (para que esto sea diagnosticable, no invisible) y resuelve
 * igual -- nunca rechaza por timeout, ese es el punto: preferir seguir
 * adelante antes que trabarse.
 */
function waitOrTimeout(promise: Promise<unknown>, timeoutMs: number, warning: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      console.warn(warning)
      resolve()
    }, timeoutMs)

    promise.then(
      () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      },
      () => {
        // Las promesas por imagen ya resuelven tanto en onload como en
        // onerror (nunca rechazan), pero por las dudas: un reject
        // inesperado tampoco debe colgar esto.
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      },
    )
  })
}

/**
 * Resuelve recien cuando el print() del driver termino (triggerPrint()
 * awaiteado en las dos ramas), no cuando el iframe se creo. Los llamadores
 * (printDeviceLabel, y por extension un loop secuencial como el de
 * recepcion-creada-modal.tsx) dependen de que este promise abarque el
 * dialogo real: si resolviera antes, un `await` encadenado dispararia el
 * siguiente print sin esperar a que el anterior termine, que es exactamente
 * lo que la impresion secuencial de etiquetas necesita evitar.
 *
 * Tambien debe *rechazar* cuando triggerPrint() rechaza (por ejemplo si
 * `print()` tira), en las dos ramas por igual -- si no, un error se pierde
 * en vez de propagarse a quien llama, y peor: si la rama quedara sin
 * resolver ni rechazar, printDeviceLabel (y todo lo que lo espera) se
 * cuelga para siempre.
 */
export async function printHtmlViaIframe(html: string): Promise<void> {
  if (typeof document === "undefined") return
  const iframe = document.createElement("iframe")
  iframe.style.position = "fixed"
  iframe.style.right = "0"
  iframe.style.bottom = "0"
  iframe.style.width = "0"
  iframe.style.height = "0"
  iframe.style.border = "0"
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument || iframe.contentWindow?.document
  if (!doc) {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    return
  }

  doc.open()
  doc.write(html)
  doc.close()

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }, 1000)
  }

  const triggerPrint = async () => {
    try {
      const imgs = Array.from(doc.images)
      await waitOrTimeout(
        Promise.all(
          imgs.map((img) =>
            img.complete && img.naturalWidth > 0
              ? Promise.resolve()
              : new Promise<void>((res) => {
                  img.onload = () => res()
                  img.onerror = () => res()
                })
          )
        ),
        IMAGE_LOAD_TIMEOUT_MS,
        "printDeviceLabel: tiempo de espera agotado cargando una imagen (QR); se imprime igual.",
      )
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } finally {
      cleanup()
    }
  }

  if (doc.readyState === "complete") {
    await triggerPrint()
    return
  }

  // Disparar triggerPrint() una sola vez, sea porque onload llego a tiempo o
  // porque se agoto el timeout y se decide seguir igual.
  //
  // `printing` cachea la promesa del PRIMER disparo, y runOnce() devuelve esa
  // misma promesa en cualquier llamada posterior. Los dos usos importan:
  //  - una sola impresion fisica por etiqueta (nunca dos print()), y
  //  - el `.then(resolve, reject)` de la segunda llamada observa el resultado
  //    del print que YA esta en vuelo.
  // Devolver ahi una promesa nueva (Promise.resolve()) cerraria el promise
  // externo en el microtask siguiente, sin relacion con el print real: el
  // caso concreto es un onload tardio que llega despues de que el timeout ya
  // arranco triggerPrint() y mientras su espera de imagenes sigue pendiente.
  // Eso resolveria printDeviceLabel antes de que se haya disparado el
  // print(), y el loop secuencial arrancaria la etiqueta siguiente con la
  // anterior en vuelo -- exactamente el pisado de dialogos que se quiere
  // evitar --, y ademas un reject posterior del print en vuelo caeria sobre
  // un promise ya cerrado y se perderia en silencio (el operador veria un
  // contador de etiquetas impresas mas alto que el real).
  await new Promise<void>((resolve, reject) => {
    let printing: Promise<void> | null = null
    const runOnce = (): Promise<void> => {
      if (!printing) printing = triggerPrint()
      return printing
    }

    const timer = setTimeout(() => {
      console.warn("printDeviceLabel: tiempo de espera agotado esperando iframe.onload; se imprime igual.")
      runOnce().then(resolve, reject)
    }, IFRAME_LOAD_TIMEOUT_MS)

    iframe.onload = () => {
      clearTimeout(timer)
      runOnce().then(resolve, reject)
    }
  })
}

