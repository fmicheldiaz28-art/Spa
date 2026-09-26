import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptPayload, generateVapidKeys, vapidAuthorization } from './web-push.js';

// Vector de prueba del RFC 8291, apéndice A.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};
const b = (s: string) => Buffer.from(s, 'base64url');
const hmac = (k: Uint8Array, d: Uint8Array) => createHmac('sha256', k).update(d).digest();

/** Descifrado del lado del navegador (para comprobar la ida y vuelta con claves aleatorias). */
function decrypt(body: Buffer, uaPrivate: Buffer, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const ikm = hmac(hmac(authSecret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const data = body.subarray(21 + idlen);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString();
}

describe('encryptPayload (RFC 8291)', () => {
  it('reproduce exactamente el vector de prueba del RFC', () => {
    const body = encryptPayload(Buffer.from(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.authSecret }, { ephemeralPrivateKey: b(RFC.asPrivate), salt: b(RFC.salt) });
    expect(body.toString('base64url')).toBe(RFC.body);
  });

  it('ida y vuelta con claves aleatorias', () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const auth = Buffer.from('0123456789abcdef');
    const body = encryptPayload(Buffer.from('{"title":"Nueva cita"}'), { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') });
    expect(decrypt(body, ua.getPrivateKey(), auth)).toBe('{"title":"Nueva cita"}');
  });
});

describe('VAPID (RFC 8292)', () => {
  it('firma un JWT ES256 válido con la audiencia del servicio push', async () => {
    const keys = generateVapidKeys();
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:admin@naturalspa.bo', 1_790_000_000_000);
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(keys.publicKey);
    const [h, p, s] = jwt!.split('.');
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
    expect(payload).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'mailto:admin@naturalspa.bo', exp: 1_790_000_000 + 12 * 3600 });
    const pub = b(keys.publicKey);
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, b(s!))).toBe(true);
  });
});
