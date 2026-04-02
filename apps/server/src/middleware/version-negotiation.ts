import type { FastifyInstance } from 'fastify';

const SUPPORTED_VERSION = '2026-01-23';

export async function versionNegotiationPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    const requestedVersion = request.headers['ucp-version'] as string | undefined;
    if (!requestedVersion) return;

    if (requestedVersion !== SUPPORTED_VERSION) {
      return reply.status(422).send({
        ucp: { version: SUPPORTED_VERSION, status: 'error' },
        messages: [
          {
            type: 'error',
            code: 'unsupported_version',
            content: `Requested UCP version ${requestedVersion} is not supported. Supported: ${SUPPORTED_VERSION}`,
            content_type: 'text/plain',
            severity: 'error',
          },
        ],
      });
    }
  });
}
