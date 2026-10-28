// Branch constants with no server dependencies, so client components can import
// them (lib/sucursal.ts uses next/headers and the Supabase client).

/**
 * Sentinel UUID used when a non-admin user has no assigned branch.
 * Applying .eq("sucursal_id", SUCURSAL_NINGUNA) matches zero real rows,
 * so the query returns empty rather than leaking all branches (fail-closed).
 */
export const SUCURSAL_NINGUNA = "00000000-0000-0000-0000-000000000000"
