/**
 * Enlaces "click to chat" de WhatsApp (wa.me): abren el chat con el mensaje ya escrito, desde el
 * celular o WhatsApp Web de quien lo usa. No requieren la API de WhatsApp Business (trámite con
 * Meta, Fase 2); el texto viene de las plantillas editables (Configuración → Mensajes).
 */

export function waLink(phoneE164: string, text: string): string {
  const digits = phoneE164.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
