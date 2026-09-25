import { ApiError, api } from './api';

/**
 * Pide al API el enlace de WhatsApp (el teléfono nunca llega a la pantalla) y lo abre.
 * La pestaña se abre en el mismo clic para que el navegador no la bloquee como ventana emergente.
 */
export async function openWhatsApp(path: string): Promise<string | null> {
  const tab = window.open('', '_blank');
  try {
    const { url } = await api<{ url: string }>(path, { method: 'POST' });
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.href = url;
    }
    return null;
  } catch (err) {
    tab?.close();
    const p = err instanceof ApiError ? err.problem : null;
    return [p?.title, p?.detail].filter(Boolean).join('. ') || 'No se pudo abrir WhatsApp';
  }
}
