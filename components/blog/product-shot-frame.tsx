import Image from "next/image"

interface ProductShotFrameProps {
  src: string
  alt: string
  // URL que se muestra en la barra del navegador (contexto de producto).
  url?: string
}

// Presenta una captura real del producto dentro de un frame de navegador sobre
// un gradiente de marca. Evita el recorte crudo (una UI estirada a 16:9 como
// banner editorial se ve mal) y da credibilidad de producto al lector del blog.
export function ProductShotFrame({ src, alt, url = "stapp.com.ar" }: ProductShotFrameProps) {
  return (
    <div className="mb-8 rounded-2xl bg-gradient-to-tr from-primary/15 via-primary/5 to-transparent p-4 sm:p-8">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-xl border bg-card shadow-xl shadow-primary/10">
        {/* Chrome del navegador */}
        <div className="flex items-center gap-2 border-b bg-card p-2.5">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
          </div>
          <div className="flex-1 truncate rounded bg-muted px-2 py-0.5 text-center text-[10px] text-muted-foreground">
            {url}
          </div>
        </div>
        <Image
          src={src}
          alt={alt}
          width={1409}
          height={912}
          className="block h-auto w-full"
          sizes="(max-width: 768px) 100vw, 672px"
          priority
        />
      </div>
    </div>
  )
}
