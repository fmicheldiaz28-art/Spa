'use client';

import { ArrowLeft, Mail, MessageCircle, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Field, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';

interface Template {
  code: string;
  channel: 'EMAIL' | 'WHATSAPP';
  label: string;
  description: string;
  variables: Record<string, string>;
  required: string[];
  subject: string | null;
  body: string;
  default: { subject: string | null; body: string };
  custom: boolean;
  updatedAt: string | null;
}

// Mismos datos de ejemplo que el API (templates/domain/templates.ts) para la vista previa inmediata.
const SAMPLE: Record<string, string> = {
  nombre: 'Camila',
  negocio: 'NaturalSpa',
  cuando: 'mañana a las 15:00',
  servicios: 'Masaje relajante con Andrea',
  direccion: 'Av. San Martín 123, Santa Cruz de la Sierra',
  enlace: 'https://naturalspa.bo/reservar/…',
  dia: 'martes 29 de septiembre',
  horarios: '09:00, 10:30, 16:00',
};

const preview = (text: string) =>
  text
    .replace(/\{([a-záéíóúñ]+)\}/gi, (_, n: string) => SAMPLE[n.toLowerCase()] ?? `{${n}}`)
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Mensajes a clientas editables (Fase 2: autonomía de Natalia). */
export default function MessagesPage() {
  const { user, can } = useAuth();
  const router = useRouter();
  const allowed = can('settings.manage');
  const [templates, setTemplates] = useState<Template[] | null>(null);

  useEffect(() => {
    if (user && !allowed) router.replace('/app');
  }, [user, allowed, router]);

  useEffect(() => {
    if (allowed) void api<Template[]>('/settings/templates').then(setTemplates);
  }, [allowed]);

  if (!allowed) return null;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/app/configuracion" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Configuración
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Mensajes a clientas</h1>
      <p className="mt-1 text-sm text-muted">
        Edita el texto de los recordatorios y avisos. Las palabras entre llaves, como <code className="rounded bg-bg px-1">{'{nombre}'}</code>, se reemplazan por los datos de
        cada clienta. Cada cambio queda en la auditoría.
      </p>
      <div className="mt-6 space-y-5">
        {templates?.map((t) => (
          <TemplateEditor key={t.code} template={t} onSaved={(u) => setTemplates((list) => list?.map((x) => (x.code === u.code ? u : x)) ?? null)} />
        ))}
      </div>
    </div>
  );
}

function TemplateEditor({ template: t, onSaved }: { template: Template; onSaved: (t: Template) => void }) {
  const [subject, setSubject] = useState(t.subject ?? '');
  const [body, setBody] = useState(t.body);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const dirty = body !== t.body || (t.channel === 'EMAIL' && subject !== (t.subject ?? ''));
  const missing = t.required.filter((r) => !body.toLowerCase().includes(`{${r}}`));

  function insert(variable: string) {
    const el = bodyRef.current;
    const token = `{${variable}}`;
    if (!el) return setBody((b) => b + token);
    const [start, end] = [el.selectionStart, el.selectionEnd];
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function run(fn: () => Promise<Template>, ok: string) {
    setBusy(true);
    setErrors([]);
    setNotice(null);
    try {
      const updated = await fn();
      onSaved(updated);
      setSubject(updated.subject ?? '');
      setBody(updated.body);
      setNotice(ok);
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      setErrors(p?.errors?.map((e) => e.message) ?? [p?.title ?? 'No se pudo guardar']);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            {t.channel === 'EMAIL' ? <Mail className="size-4 text-primary" /> : <MessageCircle className="size-4 text-primary" />}
            {t.label}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{t.description}</p>
        </div>
        {t.custom ? <Badge tone="info">Personalizado{t.updatedAt ? ` · ${formatDateTime(t.updatedAt)}` : ''}</Badge> : <Badge>Texto predeterminado</Badge>}
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          {t.channel === 'EMAIL' && (
            <Field label="Asunto" htmlFor={`${t.code}-subject`}>
              <Input id={`${t.code}-subject`} value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} />
            </Field>
          )}
          <Field label="Mensaje" htmlFor={`${t.code}-body`}>
            <textarea
              id={`${t.code}-body`}
              ref={bodyRef}
              value={body}
              maxLength={2000}
              rows={10}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </Field>
          <div>
            <p className="mb-1.5 text-xs text-muted">Insertar dato:</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(t.variables).map(([v, desc]) => (
                <button key={v} type="button" title={desc} onClick={() => insert(v)} className="rounded-full border border-border px-2 py-0.5 text-xs hover:border-primary hover:bg-primary/5">
                  {`{${v}}`}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">Vista previa</p>
          <div className="rounded-lg border border-border bg-bg p-3 text-sm">
            {t.channel === 'EMAIL' && <p className="mb-2 border-b border-border pb-2 font-medium">{preview(subject)}</p>}
            <p className="whitespace-pre-wrap">{preview(body)}</p>
          </div>
          {missing.length > 0 && (
            <p className="mt-2 text-xs text-danger">Falta {missing.map((m) => `{${m}}`).join(', ')}: sin el enlace la clienta no puede confirmar ni reservar.</p>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {errors.length > 0 && (
          <Alert>
            <ul className="list-inside list-disc">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        )}
        {notice && <Alert tone="success">{notice}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !dirty}
            onClick={() =>
              void run(
                () => api<Template>(`/settings/templates/${t.code}`, { method: 'PUT', body: JSON.stringify({ subject: t.channel === 'EMAIL' ? subject : null, body }) }),
                'Mensaje guardado. Se usará desde el próximo envío.',
              )
            }
          >
            Guardar
          </Button>
          {dirty && (
            <Button
              variant="secondary"
              onClick={() => {
                setSubject(t.subject ?? '');
                setBody(t.body);
                setErrors([]);
              }}
            >
              Descartar cambios
            </Button>
          )}
          {t.custom && (
            <Button variant="ghost" disabled={busy} onClick={() => void run(() => api<Template>(`/settings/templates/${t.code}`, { method: 'DELETE' }), 'Se restauró el texto predeterminado.')}>
              <RotateCcw className="size-4" /> Restaurar predeterminado
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
