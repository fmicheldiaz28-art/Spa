import { Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { env } from '../../config/env.js';

const ISSUER = 'naturalspa-api';
const AUDIENCE = 'naturalspa-client';

/**
 * Token de la clienta tras verificar su email con un código (docs/06-modulos.md M9).
 * No hay contraseñas para clientas: el email verificado es su identidad. Vigencia corta.
 */
@Injectable()
export class ClientTokenService {
  private readonly key = new TextEncoder().encode(env.JWT_SECRET);

  sign(email: string, organizationId: string): Promise<string> {
    return new SignJWT({ org: organizationId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(email)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('2h')
      .sign(this.key);
  }

  async verify(token: string | undefined): Promise<{ email: string; organizationId: string } | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || typeof payload.org !== 'string') return null;
      return { email: payload.sub, organizationId: payload.org };
    } catch {
      return null;
    }
  }
}
