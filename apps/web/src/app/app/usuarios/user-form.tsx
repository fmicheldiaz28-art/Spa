'use client';

import type { SystemRole } from '@naturalspa/shared';
import { Check } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Alert, Button, Field, Input, Sheet } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, STAFF_COLORS } from '@/lib/labels';
import type { RoleOption, StaffUser } from './types';

interface Props {
  open: boolean;
  user: StaffUser | null; // null = crear
  roles: RoleOption[];
  onClose: () => void;
  onSaved: (user: StaffUser, temporaryPassword: string | null) => void;
}

export function UserFormSheet({ open, user, roles, onClose, onSaved }: Props) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<SystemRole>('EMPLEADA');
  const [displayName, setDisplayName] = useState('');
  const [color, setColor] = useState(STAFF_COLORS[0]!);
  const [bookable, setBookable] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFirstName(user?.firstName ?? '');
    setLastName(user?.lastName ?? '');
    setEmail(user?.email ?? '');
    setPhone(user?.phone ?? '');
    setRole(user?.role ?? 'EMPLEADA');
    setDisplayName(user?.staff?.displayName ?? '');
    setColor(user?.staff?.color ?? STAFF_COLORS[0]!);
    setBookable(user?.staff?.isBookableOnline ?? true);
    setErrors([]);
  }, [open, user]);

  const selectable = roles.filter((r) => r.assignable || r.code === user?.role);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors([]);
    const staff = role === 'EMPLEADA' ? { displayName: displayName || undefined, color, isBookableOnline: bookable } : undefined;
    try {
      if (user) {
        const saved = await api<StaffUser>(`/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ firstName, lastName, email, phone: phone || null, role, staff }),
        });
        onSaved(saved, null);
      } else {
        const { user: saved, temporaryPassword } = await api<{ user: StaffUser; temporaryPassword: string | null }>('/users', {
          method: 'POST',
          body: JSON.stringify({ firstName, lastName, email, phone: phone || undefined, role, staff }),
        });
        onSaved(saved, temporaryPassword);
      }
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      setErrors(p?.errors?.map((x) => x.message) ?? [p?.title ?? 'No se pudo guardar']);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={user ? 'Editar usuario' : 'Nuevo usuario'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancelar
          </Button>
          <Button type="submit" form="user-form" disabled={saving || !firstName || !email}>
            {saving ? 'Guardando…' : user ? 'Guardar cambios' : 'Crear usuario'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit} className="space-y-5">
        {errors.length > 0 && (
          <Alert>
            <ul className="list-inside list-disc">
              {errors.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre *" htmlFor="firstName">
            <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoFocus />
          </Field>
          <Field label="Apellido" htmlFor="lastName">
            <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
        </div>
        <Field label="Email *" htmlFor="email" hint="Con este email inicia sesión.">
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Teléfono" htmlFor="phone" hint="Si no tiene prefijo se asume +591.">
          <Input id="phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="70012345" />
        </Field>

        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm font-medium">Rol *</legend>
          {selectable.map((r) => (
            <label
              key={r.code}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition ${role === r.code ? 'border-primary bg-primary/5' : 'border-border hover:bg-bg'}`}
            >
              <input type="radio" name="role" value={r.code} checked={role === r.code} onChange={() => setRole(r.code)} className="mt-1 accent-[var(--color-primary)]" />
              <span>
                <span className="block text-sm font-medium">{ROLE_LABELS[r.code]}</span>
                <span className="block text-xs text-muted">{ROLE_DESCRIPTIONS[r.code]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {role === 'EMPLEADA' && (
          <div className="space-y-4 rounded-lg border border-border bg-bg/60 p-4">
            <p className="text-sm font-medium">Perfil de colaboradora</p>
            <Field label="Nombre visible" htmlFor="displayName" hint="Así la verán las clientas al reservar. Por defecto, su nombre.">
              <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={firstName} />
            </Field>
            <div>
              <p className="mb-1.5 text-sm font-medium">Color en la agenda</p>
              <div className="flex flex-wrap gap-2">
                {STAFF_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="grid size-8 place-items-center rounded-full ring-offset-2 transition"
                    style={{ backgroundColor: c, boxShadow: color === c ? '0 0 0 2px var(--color-text)' : undefined }}
                    aria-label={`Color ${c}`}
                    aria-pressed={color === c}
                  >
                    {color === c && <Check className="size-4 text-text" />}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={bookable} onChange={(e) => setBookable(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
              Las clientas pueden elegirla en las reservas online
            </label>
          </div>
        )}

        {!user && (
          <p className="text-xs text-muted">
            Se generará una contraseña temporal que verás una sola vez. El usuario deberá cambiarla al ingresar.
          </p>
        )}
      </form>
    </Sheet>
  );
}
