/**
 * Plantillas editables de los mensajes a clientas (Fase 2: "autonomía de Natalia").
 * Texto plano con variables entre llaves: {nombre}, {cuando}, {enlace}… Sin HTML ni lógica.
 */

export type TemplateCode = 'REMINDER_EMAIL' | 'REMINDER_WHATSAPP' | 'WAITLIST_EMAIL' | 'WAITLIST_WHATSAPP';

export interface TemplateDefinition {
  code: TemplateCode;
  channel: 'EMAIL' | 'WHATSAPP';
  label: string;
  description: string;
  /** Variables disponibles y su descripción. */
  variables: Record<string, string>;
  /** Variables que no pueden faltar (sin el enlace la clienta no puede actuar). */
  required: string[];
  subject: string | null;
  body: string;
}

const COMMON = {
  nombre: 'Nombre de la clienta',
  negocio: 'Nombre del spa',
  enlace: 'Enlace para confirmar, reagendar o cancelar',
};

export const TEMPLATES: Record<TemplateCode, TemplateDefinition> = {
  REMINDER_EMAIL: {
    code: 'REMINDER_EMAIL',
    channel: 'EMAIL',
    label: 'Recordatorio por email',
    description: 'Se envía automáticamente antes de la cita (24 h y 2 h, según Configuración).',
    variables: { ...COMMON, cuando: 'Día y hora ("mañana a las 15:00")', servicios: 'Servicios y especialista', direccion: 'Dirección del spa' },
    required: ['enlace'],
    subject: 'Recordatorio: tu cita {cuando} · {negocio}',
    body: [
      'Hola {nombre}:',
      '',
      'Te esperamos {cuando} para {servicios}.',
      'Dirección: {direccion}',
      '',
      'Por favor confirma tu asistencia. Si no puedes venir, reagenda o cancela aquí:',
      '{enlace}',
      '',
      'Te recomendamos llegar 10 minutos antes.',
      '{negocio}',
    ].join('\n'),
  },
  REMINDER_WHATSAPP: {
    code: 'REMINDER_WHATSAPP',
    channel: 'WHATSAPP',
    label: 'Recordatorio por WhatsApp',
    description: 'Mensaje que se escribe al tocar "Recordar por WhatsApp" en la ficha de la cita.',
    variables: { ...COMMON, cuando: 'Día y hora ("mañana a las 15:00")', servicios: 'Servicios y especialista' },
    required: ['enlace'],
    subject: null,
    body: ['Hola {nombre} 🌿', 'Te recordamos tu cita en {negocio} {cuando}: {servicios}.', '', 'Confirma tu asistencia, reagenda o cancela aquí: {enlace}', '', '¡Te esperamos!'].join('\n'),
  },
  WAITLIST_EMAIL: {
    code: 'WAITLIST_EMAIL',
    channel: 'EMAIL',
    label: 'Lista de espera por email',
    description: 'Se envía automáticamente cuando se libera un horario que le sirve a la clienta.',
    variables: { ...COMMON, enlace: 'Enlace para reservar ese día', dia: 'Día ("martes 29 de septiembre")', servicios: 'Servicio (y especialista, si la eligió)', horarios: 'Horarios libres' },
    required: ['enlace'],
    subject: '¡Se liberó un horario el {dia}! · {negocio}',
    body: [
      'Hola {nombre}:',
      '',
      'Se liberó lugar para {servicios} el {dia}.',
      'Horarios disponibles ahora: {horarios}.',
      '',
      'Resérvalo antes de que lo tome otra persona: {enlace}',
      '',
      'Te avisamos porque te anotaste en la lista de espera. {negocio}',
    ].join('\n'),
  },
  WAITLIST_WHATSAPP: {
    code: 'WAITLIST_WHATSAPP',
    channel: 'WHATSAPP',
    label: 'Lista de espera por WhatsApp',
    description: 'Mensaje que se escribe al tocar "WhatsApp" en la lista de espera.',
    variables: { ...COMMON, enlace: 'Enlace para reservar ese día', dia: 'Día ("martes 29 de septiembre")', servicios: 'Servicio', horarios: 'Horarios libres' },
    required: ['enlace'],
    subject: null,
    body: ['Hola {nombre} 🌿', 'Se liberó un horario en {negocio} para {servicios} el {dia} ({horarios}).', '', 'Si te sirve, resérvalo aquí antes de que se ocupe: {enlace}', 'O respóndenos por este chat y te lo agendamos.'].join('\n'),
  },
};

export const TEMPLATE_CODES = Object.keys(TEMPLATES) as TemplateCode[];

const VARIABLE = /\{([a-záéíóúñ]+)\}/gi;

/** Reemplaza las variables; una variable sin valor queda vacía (nunca se ve "{…}" en el mensaje). */
export function render(text: string, vars: Record<string, string | null | undefined>): string {
  return text
    .replace(VARIABLE, (_, name: string) => vars[name.toLowerCase()] ?? '')
    .split('\n')
    .filter((line, i, all) => !(line.trim() === '' && all[i - 1]?.trim() === '')) // sin líneas en blanco dobles
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

/** Errores de una plantilla editada: variables desconocidas, obligatorias ausentes o largo excesivo. */
export function validate(code: TemplateCode, subject: string | null, body: string): string[] {
  const def = TEMPLATES[code];
  const errors: string[] = [];
  const used = new Set([...`${subject ?? ''}\n${body}`.matchAll(VARIABLE)].map((m) => m[1]!.toLowerCase()));
  for (const v of used) if (!(v in def.variables)) errors.push(`La variable {${v}} no existe en este mensaje`);
  for (const r of def.required) if (!body.toLowerCase().includes(`{${r}}`)) errors.push(`El mensaje debe incluir {${r}}`);
  if (!body.trim()) errors.push('El mensaje no puede estar vacío');
  if (body.length > 2000) errors.push('El mensaje es demasiado largo (máximo 2000 caracteres)');
  if (def.channel === 'EMAIL' && !subject?.trim()) errors.push('El asunto no puede estar vacío');
  if (subject && subject.length > 150) errors.push('El asunto es demasiado largo (máximo 150 caracteres)');
  return errors;
}

/** Datos de ejemplo para la vista previa en Configuración. */
export const SAMPLE_VARS: Record<string, string> = {
  nombre: 'Camila',
  negocio: 'NaturalSpa',
  cuando: 'mañana a las 15:00',
  servicios: 'Masaje relajante con Andrea',
  direccion: 'Av. San Martín 123, Santa Cruz de la Sierra',
  enlace: 'https://naturalspa.bo/reservar/gestionar/…',
  dia: 'martes 29 de septiembre',
  horarios: '09:00, 10:30, 16:00',
};
