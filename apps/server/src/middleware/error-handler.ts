import type { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { AdapterError } from '@ucp-gateway/core';

interface ErrorBody {
  readonly messages: readonly {
    readonly type: 'error';
    readonly code: string;
    readonly content: string;
    readonly severity: 'recoverable';
  }[];
}

function buildErrorBody(code: string, message: string, _httpStatus: number): ErrorBody {
  return { messages: [{ type: 'error', code, content: message, severity: 'recoverable' }] };
}

function isFastifyValidationError(error: unknown): error is FastifyError & { validation: unknown } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'validation' in error &&
    Boolean((error as Record<string, unknown>)['validation'])
  );
}

function isFastifyHttpError(error: unknown): error is FastifyError & { statusCode: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof (error as Record<string, unknown>)['statusCode'] === 'number'
  );
}

export const errorHandlerPlugin = fp(async function errorHandler(
  app: FastifyInstance,
): Promise<void> {
  app.setErrorHandler(
    (error: FastifyError | AdapterError | Error, _request: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof AdapterError) {
        return reply
          .status(error.statusCode)
          .send(buildErrorBody(error.code, error.message, error.statusCode));
      }

      if (isFastifyValidationError(error)) {
        return reply.status(400).send(buildErrorBody('VALIDATION_ERROR', error.message, 400));
      }

      if (isFastifyHttpError(error)) {
        const code = error.statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
        return reply
          .status(error.statusCode)
          .send(buildErrorBody(code, error.message, error.statusCode));
      }

      app.log.error(error);
      return reply
        .status(500)
        .send(buildErrorBody('INTERNAL_ERROR', 'An unexpected error occurred', 500));
    },
  );
});
