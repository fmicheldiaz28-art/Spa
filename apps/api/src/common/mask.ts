/**
 * Enmascaramiento de datos de contacto (docs/07-roles-permisos.md §11.6).
 * "+59170012345" → "+591 7••••••45" · "maria.rojas@gmail.com" → "m••••@gmail.com"
 */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const country = phone.startsWith('+591') ? '+591' : phone.slice(0, Math.min(3, phone.length - 4));
  const local = phone.slice(country.length);
  if (local.length <= 3) return `${country} •••`;
  return `${country} ${local[0]}${'•'.repeat(local.length - 3)}${local.slice(-2)}`;
}

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at < 1) return '••••';
  return `${email[0]}••••${email.slice(at)}`;
}

/** "Rojas" → "R." (la especialista ve nombre + inicial del apellido). */
export function lastNameInitial(lastName: string): string {
  return lastName ? `${lastName.trim()[0]!.toUpperCase()}.` : '';
}
