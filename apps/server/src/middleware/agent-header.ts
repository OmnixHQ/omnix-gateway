import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { buildUCPErrorBody } from '../routes/checkout-helpers.js';

const SKIP_PATHS = new Set(['/health', '/ready']);
const RFC_8941_PROFILE_PATTERN = /profile="([^"]+)"/;
const RFC_8941_VERSION_PATTERN = /version="([^"]+)"/;
const SERVER_UCP_VERSION = '2026-01-23';

function getUrlPath(url: string): string {
  return url.split('?')[0]!;
}

function isPublicEndpoint(path: string): boolean {
  return SKIP_PATHS.has(path) || path.startsWith('/.well-known/');
}

function isValidAgentHeader(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function extractAgentProfile(header: string): string | null {
  const match = RFC_8941_PROFILE_PATTERN.exec(header);
  return match?.[1] ?? null;
}

function extractAgentVersion(header: string): string | null {
  const match = RFC_8941_VERSION_PATTERN.exec(header);
  return match?.[1] ?? null;
}

function isVersionSupported(clientVersion: string): boolean {
  return clientVersion <= SERVER_UCP_VERSION;
}

export const agentHeaderPlugin = fp(async function agentHeader(
  app: FastifyInstance,
): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = getUrlPath(request.url);
    if (isPublicEndpoint(path)) return;

    const agentHeader = request.headers['ucp-agent'];
    if (!isValidAgentHeader(agentHeader)) {
      void reply
        .status(401)
        .send(
          buildUCPErrorBody(
            'invalid_agent',
            'Missing or invalid UCP-Agent header. Format: profile="https://example.com/agent.json"',
          ),
        );
      return;
    }

    const headerStr = agentHeader as string;

    const clientVersion = extractAgentVersion(headerStr);
    if (clientVersion && !isVersionSupported(clientVersion)) {
      void reply
        .status(400)
        .send(
          buildUCPErrorBody(
            'version_unsupported',
            `UCP version ${clientVersion} is not supported. Server supports up to ${SERVER_UCP_VERSION}`,
          ),
        );
      return;
    }

    const profileUrl = extractAgentProfile(headerStr);
    if (profileUrl) {
      request.log = request.log.child({ agentProfile: profileUrl });
    }
  });
});
