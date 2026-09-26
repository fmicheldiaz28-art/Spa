import { describe, expect, it } from 'vitest';
import { textToHtml } from './email-html.js';

describe('textToHtml', () => {
  const url = 'https://naturalspa.bo/reservar/gestionar/abc';

  it('escapa el texto (una plantilla no puede inyectar HTML)', () => {
    const html = textToHtml('Hola <script>alert(1)</script> & "amiga"');
    expect(html).toContain('Hola &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;amiga&quot;');
    expect(html).not.toContain('<script>');
  });

  it('el enlace solo en su línea se convierte en botón', () => {
    const html = textToHtml(`Confirma aquí:\n${url}`, { url, label: 'Confirmar asistencia' });
    expect(html).toContain(`<a href="${url}" style="display:inline-block;background:#3f7d5c`);
    expect(html).toContain('>Confirmar asistencia</a>');
  });

  it('el enlace dentro de una frase queda como texto clicable', () => {
    const html = textToHtml(`Resérvalo aquí: ${url} antes de que se ocupe`, { url, label: 'Reservar ahora' });
    expect(html).toContain(`Resérvalo aquí: <a href="${url}" style="color:#3f7d5c">Reservar ahora</a> antes`);
  });

  it('párrafos por línea en blanco y saltos de línea dentro del párrafo', () => {
    expect(textToHtml('A\nB\n\nC')).toContain('<p style="margin:0 0 14px">A<br>B</p>\n<p style="margin:0 0 14px">C</p>');
  });
});
