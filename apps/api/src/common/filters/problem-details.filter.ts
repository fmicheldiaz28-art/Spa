import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { currentContext } from '../context/request-context.js';
import { AppException } from '../errors.js';

/** Convierte cualquier error en Problem Details (RFC 9457) sin filtrar detalles internos. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = currentContext()?.requestId;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let title = 'Ocurrió un error inesperado';
    let detail: string | undefined;
    let errors: unknown;

    if (exception instanceof AppException) {
      status = exception.getStatus();
      ({ code, title, detail, errors } = exception);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = HttpStatus[status] ?? 'HTTP_ERROR';
      title = exception.message;
    } else {
      this.logger.error({ requestId, err: exception }, 'Error no controlado');
    }

    res
      .status(status)
      .type('application/problem+json')
      .json({
        type: `https://docs.naturalspa.app/errors/${code.toLowerCase().replaceAll('_', '-')}`,
        title,
        status,
        code,
        detail,
        instance: req.originalUrl,
        requestId,
        errors,
      });
  }
}
