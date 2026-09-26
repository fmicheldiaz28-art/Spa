/**
 * HTML simple y seguro para los emails a partir del texto de la plantilla: todo se escapa, cada
 * línea es un párrafo y el enlace de acción se muestra como botón.
 */
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function textToHtml(text: string, action?: { url: string; label: string }): string {
  const blocks = text.split(/\n{2,}/).map((block) => {
    if (action && block.trim() === action.url) {
      return `<p><a href="${esc(action.url)}" style="display:inline-block;background:#3f7d5c;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${esc(action.label)}</a></p>`;
    }
    const lines = block.split('\n').map((line) => {
      const escaped = esc(line);
      if (!action || !line.includes(action.url)) return escaped;
      // El enlace dentro de una frase: clicable, con texto corto en lugar de la URL larga.
      if (line.trim() === action.url) return `<a href="${esc(action.url)}" style="display:inline-block;background:#3f7d5c;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;margin-top:6px">${esc(action.label)}</a>`;
      return escaped.replace(esc(action.url), `<a href="${esc(action.url)}" style="color:#3f7d5c">${esc(action.label)}</a>`);
    });
    return `<p style="margin:0 0 14px">${lines.join('<br>')}</p>`;
  });
  return `<div style="font-family:system-ui,sans-serif;max-width:480px;color:#1f2a24;line-height:1.5">${blocks.join('\n')}</div>`;
}
