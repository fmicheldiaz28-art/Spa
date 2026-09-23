import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { env } from '../../config/env.js';

export interface AccessTokenClaims {
  sub: string;
  sid: string;
}

const ISSUER = 'naturalspa-api';
const AUDIENCE = 'naturalspa';

/**
 * Access token JWT de corta duración + refresh token opaco rotativo (docs/05-api.md §1.1).
 * Los permisos no viajan en el token: se resuelven en el servidor en cada petición.
 */
@Injectable()
export class TokenService {
  private readonly key = new TextEncoder().encode(env.JWT_SECRET);

  signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ sid: claims.sid })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SEC}s`)
      .sign(this.key);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
      return { sub: payload.sub, sid: payload.sid };
    } catch {
      return null;
    }
  }

  /** Refresh token opaco de 256 bits; en la base de datos solo se guarda su SHA-256. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
