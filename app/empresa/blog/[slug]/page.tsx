import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Calendar, Clock, ArrowRight } from "lucide-react"
import { BreadcrumbJsonLd } from "@/components/seo/json-ld"
import { blogPosts, getBlogPostBySlug } from "@/lib/blog-data"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"

interface BlogPostPageProps {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  return blogPosts.map((post) => ({
    slug: post.slug,
  }))
}

export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params
  const post = getBlogPostBySlug(slug)

  if (!post) {
    return { title: "Artículo no encontrado" }
  }

  return {
    title: post.title,
    description: post.excerpt,
    keywords: post.keywords,
    openGraph: {
      title: `${post.title} - Blog STApp`,
      description: post.excerpt,
      url: `https://stapp.com.ar/empresa/blog/${post.slug}`,
      type: "article",
      publishedTime: post.date,
      authors: ["STApp"],
      images: [
        {
          url: `/api/og?title=${encodeURIComponent(post.title)}&description=${encodeURIComponent(post.excerpt)}`,
          width: 1200,
          height: 630,
          alt: post.title,
        },
      ],
    },
    alternates: {
      canonical: `https://stapp.com.ar/empresa/blog/${post.slug}`,
    },
  }
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params
  const post = getBlogPostBySlug(slug)

  if (!post) {
    notFound()
  }

  const relatedPosts = blogPosts
    .filter((p) => p.category === post.category && p.id !== post.id)
    .slice(0, 3)

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", url: "https://stapp.com.ar" },
          { name: "Blog", url: "https://stapp.com.ar/empresa/blog" },
          {
            name: post.title,
            url: `https://stapp.com.ar/empresa/blog/${post.slug}`,
          },
        ]}
      />

      <div className="min-h-dvh bg-gradient-to-b from-muted/50 to-background">
        {/* Header */}
        <header className="border-b bg-card">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <Link href="/empresa/blog">
              <Button variant="ghost" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Volver al blog
              </Button>
            </Link>
          </div>
        </header>

        {/* Article */}
        <article className="py-12 sm:py-16">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              {/* Article header */}
              <div className="mb-8">
                <span className="bg-primary text-white text-xs font-semibold px-3 py-1 rounded-full">
                  {post.category}
                </span>

                <h1 className="text-3xl sm:text-4xl font-bold text-foreground mt-4 mb-4">
                  {post.title}
                </h1>

                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    <time dateTime={post.date}>
                      {new Date(post.date).toLocaleDateString("es-AR", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        timeZone: DEFAULT_TIMEZONE,
                      })}
                    </time>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    <span>{post.readTime} de lectura</span>
                  </div>
                </div>
              </div>

              {/* Featured image */}
              <div className="aspect-video relative rounded-lg overflow-hidden mb-8">
                <Image
                  src={post.image}
                  alt={`${post.title} - Artículo del blog de STApp sobre ${post.category.toLowerCase()} para talleres de reparación`}
                  fill
                  sizes="(max-width: 768px) 100vw, 768px"
                  className="object-cover"
                  priority
                />
              </div>

              {/* Article content */}
              <div className="prose prose-lg dark:prose-invert max-w-none">
                {post.content.split("\n").map((line, i) => {
                  const trimmed = line.trim()
                  if (!trimmed) return null
                  if (trimmed.startsWith("## "))
                    return (
                      <h2 key={i} className="text-2xl font-bold mt-8 mb-4">
                        {trimmed.replace("## ", "")}
                      </h2>
                    )
                  if (trimmed.startsWith("### "))
                    return (
                      <h3 key={i} className="text-xl font-semibold mt-6 mb-3">
                        {trimmed.replace("### ", "")}
                      </h3>
                    )
                  if (trimmed.startsWith("- **"))
                    return (
                      <li key={i} className="ml-4 mb-1">
                        <strong>
                          {trimmed.match(/\*\*(.*?)\*\*/)?.[1]}
                        </strong>
                        : {trimmed.replace(/- \*\*.*?\*\*:?\s*/, "")}
                      </li>
                    )
                  if (trimmed.startsWith("- "))
                    return (
                      <li key={i} className="ml-4 mb-1">
                        {trimmed.replace("- ", "")}
                      </li>
                    )
                  if (/^\d+\.\s/.test(trimmed))
                    return (
                      <li key={i} className="ml-4 mb-1 list-decimal">
                        {trimmed.replace(/^\d+\.\s/, "")}
                      </li>
                    )
                  return (
                    <p key={i} className="text-muted-foreground mb-4">
                      {trimmed}
                    </p>
                  )
                })}
              </div>

              {/* CTA */}
              <div className="mt-12 p-6 bg-primary/5 rounded-lg border border-primary/20 text-center">
                <h3 className="text-xl font-bold mb-2">
                  ¿Listo para profesionalizar tu taller?
                </h3>
                <p className="text-muted-foreground mb-4">
                  Probá STApp gratis por 30 días. Sin tarjeta de crédito.
                </p>
                <Link href="/registro">
                  <Button size="lg">Comenzar gratis</Button>
                </Link>
              </div>
            </div>
          </div>
        </article>

        {/* Related posts */}
        {relatedPosts.length > 0 && (
          <section className="py-12 border-t">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8">
              <div className="max-w-5xl mx-auto">
                <h2 className="text-2xl font-bold mb-8">
                  Artículos relacionados
                </h2>
                <div className="grid md:grid-cols-3 gap-6">
                  {relatedPosts.map((related) => (
                    <Link
                      key={related.id}
                      href={`/empresa/blog/${related.slug}`}
                      className="group"
                    >
                      <div className="aspect-video relative rounded-lg overflow-hidden mb-3">
                        <Image
                          src={related.image}
                          alt={`${related.title} - Artículo sobre ${related.category.toLowerCase()} para talleres`}
                          fill
                          sizes="(max-width: 768px) 100vw, 33vw"
                          className="object-cover group-hover:scale-105 transition-transform"
                          loading="lazy"
                        />
                      </div>
                      <h3 className="font-semibold group-hover:text-primary transition-colors line-clamp-2">
                        {related.title}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        {related.readTime} de lectura
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="border-t bg-card py-8">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-center text-muted-foreground">
              © {new Date().getFullYear()} STApp. Todos los derechos
              reservados.
            </p>
          </div>
        </footer>
      </div>
    </>
  )
}
