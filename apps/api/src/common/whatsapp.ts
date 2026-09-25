/**
 * Enlaces "click to chat" de WhatsApp (wa.me): abren el chat con el mensaje ya escrito, desde el
 * celular o WhatsApp Web de quien lo usa. No requieren la API de WhatsApp Business (trámite con
 * Meta, Fase 2); cuando esté aprobada, los mismos textos pasan a ser plantillas.
 */

export function waLink(phoneE164: string, text: string): string {
  const digits = phoneE164.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function reminderText(p: { firstName: string; when: string; services: string; orgName: string; manageUrl: string }): string {
  return [
    `Hola ${p.firstName} 🌿`,
    `Te recordamos tu cita en ${p.orgName} ${p.when}: ${p.services}.`,
    '',
    `Confirma tu asistencia, reagenda o cancela aquí: ${p.manageUrl}`,
    '',
    '¡Te esperamos!',
  ].join('\n');
}

export function waitlistText(p: { firstName: string; day: string; service: string; times: string[]; orgName: string; bookUrl: string }): string {
  const shown = p.times.slice(0, 5).join(', ');
  return [
    `Hola ${p.firstName} 🌿`,
    `Se liberó un horario en ${p.orgName} para ${p.service} el ${p.day}${shown ? ` (${shown})` : ''}.`,
    '',
    `Si te sirve, resérvalo aquí antes de que se ocupe: ${p.bookUrl}`,
    'O respóndenos por este chat y te lo agendamos.',
  ].join('\n');
}
