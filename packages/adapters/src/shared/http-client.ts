import { AdapterError } from '@ucp-gateway/core';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface HttpClientConfig {
  readonly baseUrl: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs?: number | undefined;
}

export async function httpGet<T>(config: HttpClientConfig, path: string): Promise<T> {
  const url = `${config.baseUrl}${path}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: config.headers,
    signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  return handleResponse<T>(response);
}

export async function httpPost<T>(
  config: HttpClientConfig,
  path: string,
  body: unknown,
): Promise<T> {
  const url = `${config.baseUrl}${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...config.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  return handleResponse<T>(response);
}

export async function httpPut<T>(
  config: HttpClientConfig,
  path: string,
  body: unknown,
): Promise<T> {
  const url = `${config.baseUrl}${path}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { ...config.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  return handleResponse<T>(response);
}

export async function httpDelete<T>(config: HttpClientConfig, path: string): Promise<T> {
  const url = `${config.baseUrl}${path}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: config.headers,
    signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  return handleResponse<T>(response);
}

async function handleResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 404) {
      throw new AdapterError('PRODUCT_NOT_FOUND', `API 404: ${text}`, 404);
    }
    throw new AdapterError(
      'PLATFORM_ERROR',
      `API error ${response.status}: ${text}`,
      response.status,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AdapterError(
      'PLATFORM_ERROR',
      `Invalid JSON (status=${response.status}) from ${response.url}: ${text.slice(0, 500)}`,
      500,
    );
  }
}
