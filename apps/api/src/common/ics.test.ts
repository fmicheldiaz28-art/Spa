import { describe, expect, it } from 'vitest';
import { buildIcs } from './ics.js';

describe('buildIcs', () => {
  const ics = buildIcs(
    { uid: 'NS-1@naturalspa', start: new Date('2026-09-24T19:00:00Z'), end: new Date('2026-09-24T20:00:00Z'), summary: 'Masaje; relajante, 60 min', location: 'Av. Busch 123\nSanta Cruz' },
    new Date('2026-09-23T12:00:00Z'),
  );

  it('usa UTC y CRLF', () => {
    expect(ics).toContain('DTSTART:20260924T190000Z\r\n');
    expect(ics).toContain('DTSTAMP:20260923T120000Z\r\n');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('escapa texto', () => {
    expect(ics).toContain('SUMMARY:Masaje\\; relajante\\, 60 min');
    expect(ics).toContain('LOCATION:Av. Busch 123\\nSanta Cruz');
  });

  it('pliega líneas largas a 75 octetos', () => {
    const long = buildIcs({ uid: 'x', start: new Date(), end: new Date(), summary: 'ñ'.repeat(100) });
    for (const line of long.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });
});
