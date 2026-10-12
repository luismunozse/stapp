/**
 * fullyReturnedItemIds — which sale lines end up 100% returned after a batch.
 *
 * A `garantias_venta` row covers a whole sale LINE, not a unit. Returning 1 of
 * 3 units leaves the warranty legitimately covering the other 2, so a warranty
 * may only be voided once the line is fully returned counting every prior
 * return, not just this batch.
 *
 * Mirrors the same computation inside the `registrar_devolucion_atomica` RPC:
 * a change here must be replicated there.
 */
import { describe, it, expect } from "vitest"
import { fullyReturnedItemIds } from "@/lib/devolucion-refund"

describe("fullyReturnedItemIds", () => {
  it("returns a line fully returned by this batch alone", () => {
    const ids = fullyReturnedItemIds(
      [{ id: "iv1", cantidad: 3 }],
      {},
      [{ itemVentaId: "iv1", cantidad: 3 }]
    )
    expect(ids).toEqual(["iv1"])
  })

  it("leaves out a partially returned line", () => {
    const ids = fullyReturnedItemIds(
      [{ id: "iv1", cantidad: 3 }],
      {},
      [{ itemVentaId: "iv1", cantidad: 1 }]
    )
    expect(ids).toEqual([])
  })

  it("counts prior returns: a batch that completes the line voids it", () => {
    const ids = fullyReturnedItemIds(
      [{ id: "iv1", cantidad: 3 }],
      { iv1: 2 },
      [{ itemVentaId: "iv1", cantidad: 1 }]
    )
    expect(ids).toEqual(["iv1"])
  })

  it("only reports lines touched by this batch", () => {
    // iv2 was already fully returned in an earlier devolución — its warranty was
    // voided back then. Re-reporting it would rewrite untouched history.
    const ids = fullyReturnedItemIds(
      [
        { id: "iv1", cantidad: 2 },
        { id: "iv2", cantidad: 1 },
      ],
      { iv2: 1 },
      [{ itemVentaId: "iv1", cantidad: 2 }]
    )
    expect(ids).toEqual(["iv1"])
  })

  it("reports every line the batch completes", () => {
    const ids = fullyReturnedItemIds(
      [
        { id: "iv1", cantidad: 2 },
        { id: "iv2", cantidad: 1 },
        { id: "iv3", cantidad: 4 },
      ],
      {},
      [
        { itemVentaId: "iv1", cantidad: 2 },
        { itemVentaId: "iv2", cantidad: 1 },
        { itemVentaId: "iv3", cantidad: 2 },
      ]
    )
    expect(ids).toEqual(["iv1", "iv2"])
  })

  it("ignores batch entries with no matching sale line", () => {
    const ids = fullyReturnedItemIds(
      [{ id: "iv1", cantidad: 1 }],
      {},
      [{ itemVentaId: "ghost", cantidad: 9 }]
    )
    expect(ids).toEqual([])
  })

  it("treats over-return as fully returned", () => {
    const ids = fullyReturnedItemIds(
      [{ id: "iv1", cantidad: 2 }],
      { iv1: 2 },
      [{ itemVentaId: "iv1", cantidad: 1 }]
    )
    expect(ids).toEqual(["iv1"])
  })

  it("parses string quantities coming straight from the DB", () => {
    const ids = fullyReturnedItemIds(
      [{ id: "iv1", cantidad: "2" }],
      {},
      [{ itemVentaId: "iv1", cantidad: 2 }]
    )
    expect(ids).toEqual(["iv1"])
  })

  it("returns nothing for an empty batch", () => {
    expect(fullyReturnedItemIds([{ id: "iv1", cantidad: 1 }], {}, [])).toEqual([])
  })
})
