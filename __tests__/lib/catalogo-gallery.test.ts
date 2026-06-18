// __tests__/lib/catalogo-gallery.test.ts
import { describe, it, expect } from "vitest"
import { addImage, setCover, removeCover, removeFromGallery, type Gallery } from "@/lib/catalogo/gallery"

const empty: Gallery = { cover: null, gallery: [] }

describe("addImage", () => {
  it("first image with no cover becomes the cover", () => {
    expect(addImage(empty, "a.jpg")).toEqual({ cover: "a.jpg", gallery: [] })
  })
  it("subsequent images go to the gallery", () => {
    const s = addImage({ cover: "a.jpg", gallery: [] }, "b.jpg")
    expect(s).toEqual({ cover: "a.jpg", gallery: ["b.jpg"] })
  })
  it("dedups: url already cover is a no-op", () => {
    expect(addImage({ cover: "a.jpg", gallery: [] }, "a.jpg")).toEqual({ cover: "a.jpg", gallery: [] })
  })
  it("dedups: url already in gallery is a no-op", () => {
    expect(addImage({ cover: "a.jpg", gallery: ["b.jpg"] }, "b.jpg")).toEqual({ cover: "a.jpg", gallery: ["b.jpg"] })
  })
})

describe("setCover", () => {
  it("promotes a gallery image and demotes the old cover into the gallery", () => {
    const s = setCover({ cover: "a.jpg", gallery: ["b.jpg", "c.jpg"] }, "b.jpg")
    expect(s.cover).toBe("b.jpg")
    expect(s.gallery).toContain("a.jpg")
    expect(s.gallery).not.toContain("b.jpg")
    expect(s.gallery).toContain("c.jpg")
  })
  it("never leaves the cover duplicated in the gallery", () => {
    const s = setCover({ cover: "a.jpg", gallery: ["b.jpg"] }, "b.jpg")
    expect(s.gallery).not.toContain(s.cover as string)
  })
  it("setting current cover is a no-op", () => {
    expect(setCover({ cover: "a.jpg", gallery: ["b.jpg"] }, "a.jpg")).toEqual({ cover: "a.jpg", gallery: ["b.jpg"] })
  })
  it("when there was no cover, just promotes (nothing demoted)", () => {
    expect(setCover({ cover: null, gallery: ["b.jpg"] }, "b.jpg")).toEqual({ cover: "b.jpg", gallery: [] })
  })
})

describe("removeCover", () => {
  it("clears the cover, leaves gallery untouched", () => {
    expect(removeCover({ cover: "a.jpg", gallery: ["b.jpg"] })).toEqual({ cover: null, gallery: ["b.jpg"] })
  })
})

describe("removeFromGallery", () => {
  it("removes the given url from the gallery", () => {
    expect(removeFromGallery({ cover: "a.jpg", gallery: ["b.jpg", "c.jpg"] }, "b.jpg")).toEqual({ cover: "a.jpg", gallery: ["c.jpg"] })
  })
})
