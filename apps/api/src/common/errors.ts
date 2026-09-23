import { HttpException } from '@nestjs/common';

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

/**
 * Error de negocio con código estable (docs/05-api.md §1.2).
 * El filtro ProblemDetailsFilter lo convierte en una respuesta RFC 9457.
 */
export class AppException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: FieldError[],
  ) {
    super({ code, title, detail, errors }, status);
  }
}

export const Errors = {
  unauthenticated: (detail?: string) =>
    new AppException(401, 'UNAUTHENTICATED', 'Necesitas iniciar sesión', detail),
  invalidCredentials: () =>
    new AppException(401, 'INVALID_CREDENTIALS', 'Email o contraseña incorrectos'),
  accountLocked: (minutes: number) =>
    new AppException(
      423,
      'ACCOUNT_LOCKED',
      'Cuenta bloqueada temporalmente',
      `Intenta nuevamente en ${minutes} minutos.`,
    ),
  forbidden: () => new AppException(403, 'FORBIDDEN', 'No tienes permiso para realizar esta acción'),
  notFound: () => new AppException(404, 'NOT_FOUND', 'Recurso no encontrado'),
  validation: (errors: FieldError[]) =>
    new AppException(400, 'VALIDATION_ERROR', 'Los datos enviados no son válidos', undefined, errors),
};
