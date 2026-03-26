import type { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { AdapterError } from '@ucp-gateway/core';
import { buildUCPErrorBody } from '../routes/checkout-helpers.js';

function buildErrorBody(code: string, message: string): ReturnType<typeof buildUCPErrorBody> {
  return buildUCPErrorBody(code, message);
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
          .send(buildErrorBody(error.code.toLowerCase(), error.message));
      }

      if (isFastifyValidationError(error)) {
        return reply.status(400).send(buildErrorBody('validation_error', error.message));
      }

      if (isFastifyHttpError(error)) {
        const code = error.statusCode >= 500 ? 'internal_error' : 'request_error';
        return reply.status(error.statusCode).send(buildErrorBody(code, error.message));
      }

      app.log.error(error);
      return reply
        .status(500)
        .send(buildErrorBody('internal_error', 'An unexpected error occurred'));
    },
  );
});
