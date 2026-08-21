/**
 * Projection every customer-shaped value must go through before it is handed to
 * useFormDraft (hooks/use-form-draft.ts).
 *
 * A draft is written to localStorage in plaintext, survives logout on purpose
 * and lives for up to a week, on front-desk terminals several operators share.
 * The rule the hook documents ("no customer record beyond the couple of fields
 * the restored UI reads back") was written three times by hand -- once per form
 * -- and the form holding the most personal data, ClienteForm, was the one that
 * did not get it: it persisted the whole record, national id and tax id
 * included. Losing these on restore costs the operator some retyping; leaking
 * them costs somebody else's identity documents.
 *
 * So the list lives HERE, once, and the type is what enforces it: a projection
 * built with `WithoutSensitiveClienteFields` cannot carry these keys, and a
 * field added to a customer type later is only persisted if somebody adds it to
 * the safe side on purpose.
 *
 * Not the whole rule, only its hard floor: a call site is free to persist even
 * less (recepcion-form.tsx keeps just `nombre`/`telefono`), never more.
 */

/** Never persisted: identity and tax documents, plus the two pieces of contact
 *  data the restored form does not need in order to keep going -- an address
 *  and an email address. None of it is: the customer is in front of the
 *  counter, or the record already has it.
 *
 *  `nombre` and `telefono` deliberately stay on the safe side. They are the two
 *  fields a form cannot be filled in without, they are what the restored UI
 *  reads back to say WHICH customer this draft is about, and both are already
 *  on the paper ticket sitting on that same counter. */
export const SENSITIVE_CLIENTE_FIELDS = ["dni", "cuit", "email", "direccion"] as const

export type SensitiveClienteField = (typeof SENSITIVE_CLIENTE_FIELDS)[number]

/** `T` with every field of SENSITIVE_CLIENTE_FIELDS removed. */
export type WithoutSensitiveClienteFields<T> = Omit<T, SensitiveClienteField>

/**
 * Runtime half of the type above: drops the sensitive keys from a customer-shaped
 * object. Works on the customer record AND on this form's own values, which is
 * why it is typed structurally instead of against `Cliente`.
 */
export function stripSensitiveClienteFields<T extends object>(
  value: T
): WithoutSensitiveClienteFields<T> {
  const projected = { ...value } as Record<string, unknown>
  for (const field of SENSITIVE_CLIENTE_FIELDS) {
    delete projected[field]
  }
  return projected as WithoutSensitiveClienteFields<T>
}
