import { Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { env } from '../../config/env.js';

const ISSUER = 'naturalspa-api';
const AUDIENCE = 'naturalspa-client';
const LINK_AUDIENCE = 'naturalspa-appointment-link';

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

  /**
   * Enlace de gestión firmado para los recordatorios: vale solo para esa cita y vence cuando
   * termina. No reemplaza al enlace del email de confirmación (que sigue válido).
   */
  signAppointmentLink(appointmentId: string, organizationId: string, expiresAt: Date): Promise<string> {
    return new SignJWT({ org: organizationId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(appointmentId)
      .setIssuer(ISSUER)
      .setAudience(LINK_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
  }

  async verifyAppointmentLink(token: string): Promise<{ appointmentId: string; organizationId: string } | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: LINK_AUDIENCE, algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || typeof payload.org !== 'string') return null;
      return { appointmentId: payload.sub, organizationId: payload.org };
    } catch {
      return null;
    }
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
