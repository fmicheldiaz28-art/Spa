/** "Limpieza facial profunda" → "limpieza-facial-profunda" */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Devuelve un slug que no esté en `taken`, agregando -2, -3… si hace falta. */
export function uniqueSlug(text: string, taken: Set<string>): string {
  const base = slugify(text) || 'item';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}
