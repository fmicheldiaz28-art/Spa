'use client';

import { FileUp } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button, Select, Sheet } from '@/components/ui';
import { ApiError, api } from '@/lib/api';

type Field = 'firstName' | 'lastName' | 'phone' | 'email' | 'allergies' | 'preferences' | 'notes' | '';

const FIELDS: { key: Field; label: string; guess: RegExp }[] = [
  { key: 'firstName', label: 'Nombre', guess: /^(nombre|nombres|name|clienta?|nombre completo)$/i },
  { key: 'lastName', label: 'Apellido', guess: /^(apellidos?|last ?name)$/i },
  { key: 'phone', label: 'Teléfono', guess: /(tel|cel|whats|phone|n[uú]mero)/i },
  { key: 'email', label: 'Email', guess: /(mail|correo)/i },
  { key: 'allergies', label: 'Alergias', guess: /(alerg)/i },
  { key: 'preferences', label: 'Preferencias', guess: /(prefer)/i },
  { key: 'notes', label: 'Observaciones', guess: /(obs|nota|coment)/i },
];

interface Issue {
  line: number;
  name: string;
  problem: string;
}

interface ImportReport {
  total: number;
  toImport: number;
  imported: number;
  errors: Issue[];
  duplicatesInFile: Issue[];
  alreadyInDb: Issue[];
  preview: { line: number; name: string; phone: string | null; email: string | null }[];
}

/** CSV simple (RFC 4180): comillas, comas o punto y coma como separador (Excel en español usa ";"). */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** Asistente de importación desde Google Sheets (docs/06-modulos.md M4, CU-22). */
export function ImportSheet({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (n: number) => void }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<Field[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setRows(null);
    setMapping([]);
    setReport(null);
    setError(null);
  }

  async function onFile(file: File) {
    reset();
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) return setError('El archivo no tiene filas de datos.');
    setRows(parsed);
    setMapping(parsed[0]!.map((h) => FIELDS.find((f) => f.guess.test(h.trim()))?.key ?? ''));
  }

  function payload() {
    return rows!.slice(1).map((r) => Object.fromEntries(mapping.map((f, i) => [f, r[i] ?? '']).filter(([f]) => f)));
  }

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<ImportReport>('/clients/import', { method: 'POST', body: JSON.stringify({ dryRun, rows: payload() }) });
      setReport(r);
      if (!dryRun) onImported(r.imported);
    } catch (err) {
      const p = err instanceof ApiError ? err.problem : null;
      setError([p?.title, ...(p?.errors?.slice(0, 3).map((e) => e.message) ?? [])].filter(Boolean).join(' · ') || 'No se pudo procesar');
    } finally {
      setBusy(false);
    }
  }

  const hasName = mapping.includes('firstName');
  const imported = report && report.imported > 0;

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Importar clientas"
      footer={
        rows && !imported ? (
          report ? (
            <>
              <Button variant="secondary" onClick={() => setReport(null)}>
                Volver
              </Button>
              <Button disabled={busy || report.toImport === 0} onClick={() => void run(false)}>
                Importar {report.toImport} clientas
              </Button>
            </>
          ) : (
            <Button disabled={busy || !hasName} onClick={() => void run(true)}>
              Revisar
            </Button>
          )
        ) : undefined
      }
    >
      <div className="space-y-5 text-sm">
        {error && <Alert>{error}</Alert>}
        {!rows && (
          <>
            <p className="text-muted">
              En Google Sheets: <strong className="text-text">Archivo → Descargar → Valores separados por comas (.csv)</strong>. La primera fila debe tener los títulos de las
              columnas.
            </p>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border px-6 py-10 text-center hover:border-primary">
              <FileUp className="size-8 text-primary" />
              <span className="font-medium">Elegir archivo CSV</span>
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
            </label>
          </>
        )}

        {rows && !report && (
          <>
            <p>
              {rows.length - 1} filas. Indica qué es cada columna (las reconocidas ya están elegidas):
            </p>
            <div className="space-y-2">
              {rows[0]!.map((header, i) => (
                <div key={i} className="grid grid-cols-2 items-center gap-2">
                  <span className="truncate">
                    <strong>{header || `Columna ${i + 1}`}</strong>
                    <span className="block truncate text-xs text-muted">ej.: {rows[1]?.[i] ?? ''}</span>
                  </span>
                  <Select value={mapping[i]} onChange={(e) => setMapping((m) => m.map((x, j) => (j === i ? (e.target.value as Field) : x)))} aria-label={`Columna ${header}`}>
                    <option value="">No importar</option>
                    {FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            {!hasName && <Alert tone="warning">Elige qué columna tiene el nombre.</Alert>}
          </>
        )}

        {report && (
          <div className="space-y-4">
            {imported ? (
              <Alert tone="success">Se importaron {report.imported} clientas. Quedó registrado en la auditoría.</Alert>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Listas para importar" value={report.toImport} tone="text-success" />
                <Stat label="Ya existen (se omiten)" value={report.alreadyInDb.length} />
                <Stat label="Repetidas en el archivo" value={report.duplicatesInFile.length} />
                <Stat label="Con errores" value={report.errors.length} tone={report.errors.length ? 'text-danger' : undefined} />
              </div>
            )}
            {!imported && report.preview.length > 0 && (
              <div>
                <p className="mb-1 font-medium">Vista previa</p>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {report.preview.map((p) => (
                    <li key={p.line} className="flex justify-between px-3 py-1.5 text-xs">
                      <span>{p.name}</span>
                      <span className="text-muted">{[p.phone, p.email].filter(Boolean).join(' · ') || 'sin contacto'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {[...report.errors, ...report.duplicatesInFile, ...report.alreadyInDb].length > 0 && (
              <details className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer font-medium">Ver filas omitidas</summary>
                <ul className="mt-2 space-y-1 text-xs">
                  {[...report.errors, ...report.duplicatesInFile, ...report.alreadyInDb]
                    .sort((a, b) => a.line - b.line)
                    .map((i) => (
                      <li key={`${i.line}-${i.problem}`}>
                        Fila {i.line} · {i.name}: <span className="text-muted">{i.problem}</span>
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-xl font-semibold ${tone ?? ''}`}>{value}</p>
    </div>
  );
}
