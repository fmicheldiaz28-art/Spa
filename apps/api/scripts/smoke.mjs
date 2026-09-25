// Prueba de humo contra PostgreSQL real (CI): lo que PGlite no puede demostrar en desarrollo.
//   1. Concurrencia: 10 citas simultáneas en el mismo horario → exactamente 1 creada (restricción EXCLUDE).
//   2. Auditoría: sellado con hash encadenado y verificación de la cadena.
//   3. MFA: activación y login en dos pasos con un código TOTP real.
// Uso: API corriendo en API_URL (por defecto http://localhost:4000) con el seed de demo cargado.
import pg from 'pg';
import { base32Decode, hotp, stepAt } from '../dist/modules/auth/mfa/totp.js';

const API = `${process.env.API_URL ?? 'http://localhost:4000'}/api/v1`;
const HEADERS = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };
let failures = 0;

async function call(path, { body, token, method } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...HEADERS, ...(token && { Authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function check(ok, label, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function waitForApi() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${API}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('El API no respondió en 60 s');
}

const login = async (email, password) => (await call('/auth/login', { body: { email, password } })).body;

await waitForApi();
const { accessToken: token } = await login('natalia@naturalspa.local', 'Demo123*');
check(!!token, 'Login de administración');

// ------------------------------------------------------------------ 1. concurrencia
const services = (await call('/services', { token })).body;
const list = services.items ?? services.data ?? services;
let slot;
let service;
const today = new Date();
for (let d = 1; d <= 14 && !slot; d++) {
  const date = new Date(today.getTime() + d * 86_400_000).toISOString().slice(0, 10);
  for (const s of list) {
    const r = await call(`/availability/slots?serviceId=${s.id}&date=${date}`, { token });
    if (r.body?.slots?.length) {
      slot = r.body.slots[0];
      service = s;
      break;
    }
  }
}
check(!!slot, 'Hay un horario libre para la prueba', slot ? `${service.name} ${slot.startAt}` : '');

// PGlite (desarrollo) no soporta transacciones concurrentes: SMOKE_SKIP_CONCURRENCY=1 para usarlo localmente.
if (process.env.SMOKE_SKIP_CONCURRENCY === '1') {
  console.log('- Concurrencia omitida (SMOKE_SKIP_CONCURRENCY)');
} else {
  const client = (await call('/clients', { token, body: { firstName: 'Prueba', lastName: `Concurrencia ${Date.now()}` } })).body;
  const attempts = await Promise.all(
    Array.from({ length: 10 }, () =>
      call('/appointments', { token, body: { clientId: client.id, source: 'TELEFONO', items: [{ serviceId: service.id, staffId: slot.staff[0].id, startAt: slot.startAt }] } }),
    ),
  );
  const created = attempts.filter((a) => a.status === 201).length;
  const conflicts = attempts.filter((a) => a.status === 409).length;
  const others = attempts.filter((a) => a.status !== 201 && a.status !== 409).map((a) => a.status);
  check(created === 1 && conflicts === 9, '10 reservas simultáneas del mismo horario', `${created} creada, ${conflicts} rechazadas con 409${others.length ? `, otros: ${others.join(',')}` : ''}`);
}

// ------------------------------------------------------------------ 2. auditoría
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const sealed = (await db.query(`SELECT seal_audit_logs(100000, '0 seconds') AS n`)).rows[0].n;
const chain = (await db.query('SELECT * FROM verify_audit_chain()')).rows[0];
check(sealed > 0 && !chain.problem, 'Auditoría sellada y cadena íntegra', `${chain.checked} registros`);
let blocked = false;
try {
  await db.query(`UPDATE audit_logs SET reason = 'x' WHERE seal_seq = 1`);
} catch {
  blocked = true;
}
check(blocked, 'La auditoría rechaza modificaciones');
await db.query('BEGIN');
await db.query(`SET LOCAL session_replication_role = 'replica'`);
await db.query(`UPDATE audit_logs SET reason = 'alterado' WHERE seal_seq = 1`);
const tampered = (await db.query('SELECT * FROM verify_audit_chain()')).rows[0];
await db.query('ROLLBACK');
check(!!tampered.problem, 'La verificación detecta un registro alterado saltando los triggers', tampered.problem ?? '');
const api = (await call('/audit-logs/integrity', { token })).body;
check(api?.ok === true, 'Endpoint de integridad', JSON.stringify({ checked: api?.checked, unsealed: api?.unsealed }));
await db.end();

// ------------------------------------------------------------------ 3. MFA
const andrea = (await login('andrea@naturalspa.local', 'Demo123*')).accessToken;
const setup = (await call('/auth/mfa/setup', { token: andrea, body: {} })).body;
const secret = base32Decode(setup.secret);
const enabled = await call('/auth/mfa/enable', { token: andrea, body: { code: hotp(secret, stepAt(Date.now())) } });
check(enabled.status === 200 && enabled.body.recoveryCodes?.length === 8, 'Activación de MFA');
const first = await login('andrea@naturalspa.local', 'Demo123*');
check(first.mfaRequired === true && !first.accessToken, 'Con MFA, la contraseña sola no abre sesión');
const second = await call('/auth/login/mfa', { body: { mfaToken: first.mfaToken, code: enabled.body.recoveryCodes[0] } });
check(second.status === 200 && !!second.body.accessToken, 'Segundo paso con código de recuperación');
const reused = await call('/auth/login/mfa', { body: { mfaToken: first.mfaToken, code: enabled.body.recoveryCodes[0] } });
check(reused.status === 401, 'Un código de recuperación no se puede reutilizar');

console.log(failures ? `\n${failures} verificación(es) fallaron` : '\nTodo en orden');
process.exit(failures ? 1 : 0);
