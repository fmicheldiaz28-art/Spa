export type Json = Record<string, unknown>;

/** Campos que nunca se guardan en claro en la auditoría (docs/11-seguridad-auditoria.md §20.3). */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'temporaryPassword',
  'refreshTokenHash',
  'refresh_token_hash',
  'tokenHash',
  'token_hash',
  'mfaSecretEnc',
  'mfa_secret_enc',
]);

export function redact(values: Json | null | undefined): Json | null {
  if (!values) return null;
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, REDACTED_FIELDS.has(k) ? '[REDACTED]' : normalize(v)]),
  );
}

/** Convierte valores no serializables (Date, Decimal, bigint) a una forma estable para JSON. */
function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object' && 'toFixed' in value && typeof value.toString === 'function') {
    return value.toString(); // Prisma.Decimal
  }
  return value;
}

export function changedFields(oldValues: Json | null, newValues: Json | null): string[] {
  const keys = new Set([...Object.keys(oldValues ?? {}), ...Object.keys(newValues ?? {})]);
  return [...keys].filter(
    (k) => JSON.stringify(oldValues?.[k] ?? null) !== JSON.stringify(newValues?.[k] ?? null),
  );
}

/**
 * Reduce antes/después a los campos que realmente cambiaron, para que el diff de la auditoría
 * muestre solo lo relevante.
 */
export function diff(before: Json, after: Json): { oldValues: Json; newValues: Json } | null {
  const b = redact(before)!;
  const a = redact(after)!;
  const fields = changedFields(b, a);
  if (!fields.length) return null;
  return {
    oldValues: Object.fromEntries(fields.map((f) => [f, b[f] ?? null])),
    newValues: Object.fromEntries(fields.map((f) => [f, a[f] ?? null])),
  };
}
