"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Clock, ArrowRight } from "lucide-react"
import type { BlogPost } from "@/lib/blog-data"

interface BlogListProps {
  posts: BlogPost[]
  categories: string[]
}

export function BlogList({ posts, categories }: BlogListProps) {
  const [activeCategory, setActiveCategory] = useState("Todos")

  const filtered =
    activeCategory === "Todos"
      ? posts
      : posts.filter((p) => p.category === activeCategory)

  return (
    <>
      <section className="pb-8">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap gap-3 justify-center">
            {categories.map((category) => (
              <Button
                key={category}
                variant={category === activeCategory ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveCategory(category)}
              >
                {category}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <section className="pb-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">
              No hay artículos en esta categoría todavía.
            </p>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
              {filtered.map((post) => (
                <Link key={post.id} href={`/empresa/blog/${post.slug}`}>
                  <Card className="overflow-hidden hover:shadow-lg transition-shadow h-full">
                    <div className="aspect-video bg-muted relative overflow-hidden">
                      {/* Preferimos la captura propia (self-hosted, no se pudre
                          como las URLs de stock) cuando la nota mapea 1:1 con
                          una pantalla del producto. */}
                      <Image
                        src={post.productShot?.src ?? post.image}
                        alt={
                          post.productShot
                            ? `Pantalla de ${post.category.toLowerCase()} en STApp: ${post.title}`
                            : `${post.title} - Artículo sobre ${post.category.toLowerCase()} para talleres de reparación de celulares`
                        }
                        fill
                        sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="object-cover"
                        loading="lazy"
                      />
                      <div className="absolute top-4 left-4">
                        <span className="bg-primary text-white text-xs font-semibold px-3 py-1 rounded-full">
                          {post.category}
                        </span>
                      </div>
                    </div>
                    <CardHeader>
                      {/* Contenido evergreen: no mostramos la fecha de
                          publicación (la fecha real vive en el JSON-LD para
                          buscadores). Solo el tiempo de lectura. */}
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          <span>{post.readTime} de lectura</span>
                        </div>
                      </div>
                      <CardTitle className="text-xl leading-tight hover:text-primary transition-colors">
                        {post.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-muted-foreground mb-4">{post.excerpt}</p>
                      <span className="inline-flex items-center gap-2 font-semibold text-primary">
                        Leer más
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  )
}
