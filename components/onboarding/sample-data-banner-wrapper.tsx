"use client"

import dynamic from "next/dynamic"

const SampleDataBanner = dynamic(
  () => import("./sample-data-banner").then((mod) => ({ default: mod.SampleDataBanner })),
  { ssr: false }
)

export function SampleDataBannerWrapper() {
  return <SampleDataBanner />
}
