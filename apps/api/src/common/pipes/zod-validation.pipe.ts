import type { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { Errors } from '../errors.js';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw Errors.validation(
        result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
