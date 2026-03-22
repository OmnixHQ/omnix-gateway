import type { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { AdapterError } from '@ucp-middleware/core';

/**
 * UCPM-34: Structured error response format.
 * All errors return: { error: { code, message, http_status } }
 */

interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly http_status: number;
  };
}

function buildErrorBody(code: string, message: string, httpStatus: number): ErrorBody {
  return {
    error: {
      code,
      message,
      http_status: httpStatus,
    },
  };
}

export async function errorHandlerPlugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler(
    (error: FastifyError | AdapterError | Error, _request: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof AdapterError) {
        return reply
          .status(error.statusCode)
          .send(buildErrorBody(error.code, error.message, error.statusCode));
      }

      // Fastify validation errors
      if ('validation' in error && error.validation) {
        return reply.status(400).send(
          buildErrorBody(
            'VALIDATION_ERROR',
            error.message,
            400,
          ),
        );
      }

      // Fastify errors with statusCode
      if ('statusCode' in error && typeof error.statusCode === 'number') {
        const code = error.statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
        return reply
          .status(error.statusCode)
          .send(buildErrorBody(code, error.message, error.statusCode));
      }

      // Unknown errors
      app.log.error(error);
      return reply.status(500).send(
        buildErrorBody('INTERNAL_ERROR', 'An unexpected error occurred', 500),
      );
    },
  );
}
