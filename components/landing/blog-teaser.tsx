import Link from "next/link"
import Image from "next/image"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowRight, Calendar, Clock } from "lucide-react"
import { blogPosts } from "@/lib/blog-data"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"

export function BlogTeaser() {
  const latestPosts = [...blogPosts]
    .sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
    .slice(0, 3)

  return (
    <section
      id="blog"
      className="py-16 sm:py-20"
      aria-labelledby="blog-heading"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 max-w-5xl mx-auto mb-10">
          <div>
            <h2
              id="blog-heading"
              className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-balance text-foreground mb-3"
            >
              Aprendé a escalar tu taller
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl">
              Guías, estrategias y buenas prácticas para dueños de talleres de
              reparación.
            </p>
          </div>
          <Link href="/empresa/blog" className="shrink-0">
            <Button variant="outline" className="gap-2">
              Ver todo el blog
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {latestPosts.map((post) => (
            <Link
              key={post.slug}
              href={`/empresa/blog/${post.slug}`}
              className="group"
            >
              <Card className="h-full overflow-hidden hover:border-primary/30 hover:shadow-lg transition-[border-color,box-shadow]">
                <div className="aspect-video relative overflow-hidden">
                  <Image
                    src={post.image}
                    alt={`${post.title} - Blog STApp`}
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                </div>
                <div className="p-5">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <time dateTime={post.date}>
                        {new Date(post.date).toLocaleDateString("es-AR", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          timeZone: DEFAULT_TIMEZONE,
                        })}
                      </time>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {post.readTime}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2 line-clamp-2 group-hover:text-primary transition-colors">
                    {post.title}
                  </h3>
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {post.excerpt}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
