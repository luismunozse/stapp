// @vitest-environment node
//
// Regression guard for the production-only failure that broke every react-pdf
// document (remito, recibo de cuenta corriente, resumen de cuenta) with
// "Minified React error #31 — Objects are not valid as a React child".
//
// What happened: @react-pdf/reconciler picks one of three prebuilt reconcilers
// AT RUNTIME, off `React.version` (see its lib/index.js):
//
//     major >= 20 || (major === 19 && minor >= 2)  -> reconciler-33  (React 19.2+)
//     major === 19                                 -> reconciler-31  (React 19.0/19.1)
//     otherwise                                    -> reconciler-23  (React 18 and older)
//
// The reconciler package loads from node_modules, so it reads the React the
// project declares. With react pinned to 18.3.1 it selected reconciler-23.
// But Next 16 renders app code with its OWN bundled React 19.3, whose elements
// carry `$$typeof: Symbol.for("react.transitional.element")`. A React-18
// reconciler does not recognize that symbol, treats the element as a plain
// object, and throws #31.
//
// It could not be caught by the rest of the suite: under vitest both sides
// resolve the same node_modules React, so the versions agree and rendering
// works. It only appears in a real `next build` bundle.
//
// This test locks the invariant that actually matters: the React that
// @react-pdf/reconciler resolves must be new enough to select a React-19
// reconciler, because that is what Next runs the app with.
import { describe, it, expect } from "vitest"
import React from "react"

const RECONCILER_MIN_MAJOR = 19
const RECONCILER_MIN_MINOR = 2

describe("@react-pdf/reconciler / React version match", () => {
  it("resolves a React new enough to select the React 19.2+ reconciler", () => {
    const [major, minor] = React.version.split(".").map((v) => parseInt(v, 10))

    const selected =
      major >= 20 || (major === 19 && minor >= RECONCILER_MIN_MINOR)
        ? "reconciler-33"
        : major === 19
          ? "reconciler-31"
          : "reconciler-23"

    expect(
      { reactVersion: React.version, selected },
      "react-pdf would pick a reconciler older than the React that Next runs the app with — " +
        "every PDF route throws React error #31 in a production build"
    ).toEqual({ reactVersion: React.version, selected: "reconciler-33" })

    expect(major).toBeGreaterThanOrEqual(RECONCILER_MIN_MAJOR)
  })

  it("creates elements with the symbol the React 19 reconcilers expect", () => {
    const el = React.createElement("div", null, "x") as unknown as { $$typeof: symbol }
    expect(Symbol.keyFor(el.$$typeof)).toBe("react.transitional.element")
  })
})
