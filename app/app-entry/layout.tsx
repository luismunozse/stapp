import type { Metadata } from "next"

// This route renders a client component, which cannot export metadata, so the
// metadata lives in this pass-through layout.
//
// The robots directive is what matters here: without it the route inherits
// `alternates.canonical` from the root layout and tells Google its canonical
// version is the home page. Internal/token-addressed screens must not index.
export const metadata: Metadata = {
  title: "Abriendo STApp",
  robots: { index: false, follow: false },
}

export default function AppEntryLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
