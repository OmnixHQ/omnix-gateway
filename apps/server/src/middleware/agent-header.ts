import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const SKIP_PATHS = new Set(['/health', '/ready']);

/**
 * UCPM-33: UCP-Agent header validation middleware.
 * All UCP API endpoints require a valid UCP-Agent header identifying the AI agent.
 * Format: "agent-name/version" (e.g. "mcp-host/1.0")
 */
export async function agentHeaderPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (SKIP_PATHS.has(request.url.split('?')[0]!)) {
      return;
    }

    // Skip for /.well-known/ucp — discovery endpoint is public
    if (request.url.startsWith('/.well-known/')) {
      return;
    }

    const agentHeader = request.headers['ucp-agent'];
    if (!agentHeader || typeof agentHeader !== 'string' || agentHeader.trim().length === 0) {
      void reply.status(401).send({
        error: {
          code: 'INVALID_AGENT',
          message: 'Missing or invalid UCP-Agent header. Format: "agent-name/version"',
          http_status: 401,
        },
      });
      return;
    }
  });
}
