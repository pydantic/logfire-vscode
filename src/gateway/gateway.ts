import { GatewayAuth } from './auth';
import { Instance, requestTimeoutMs } from './config';

/** A model as returned by the gateway's aggregated `/proxy/models` endpoint. */
export interface GatewayModel {
  id: string;
  name?: string;
  context_window?: number;
}

/** Models grouped by route (provider slug) — the `/proxy/models` response shape. */
export interface RouteModels {
  route: string;
  provider: string;
  models: GatewayModel[];
}

/** Thrown when the gateway rejects the token (wrong region / no access). */
export class GatewayAccessError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// `AbortSignal.any` is available in the VSCode/Node runtime but isn't in the
// pinned TypeScript DOM lib, so reach it through a narrow typed accessor.
const abortSignalAny = (AbortSignal as unknown as { any(signals: AbortSignal[]): AbortSignal }).any;

/** Compose the caller's abort signal (if any) with a request timeout. */
export function timeoutSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(requestTimeoutMs());
  return signal ? abortSignalAny([signal, timeout]) : timeout;
}

/**
 * HTTP client for the Logfire AI Gateway, bound to a specific instance per call.
 * Injects the instance's OAuth bearer token, applies the configured timeout, and
 * refreshes + retries once on 401.
 */
export class GatewayClient {
  constructor(private readonly auth: GatewayAuth) {}

  /**
   * List available models for an instance, grouped by route. Uses the
   * aggregated `GET {gateway}/proxy/models` endpoint (auth accepts the OAuth
   * bearer JWT). 401/403 surfaces as GatewayAccessError.
   */
  async listModels(instance: Instance): Promise<RouteModels[]> {
    const res = await this.authed(instance, (token) =>
      fetch(`${instance.gateway}/proxy/models`, {
        headers: { authorization: `Bearer ${token}` },
        signal: timeoutSignal(),
      }),
    );
    if (res.status === 401 || res.status === 403) {
      throw new GatewayAccessError(res.status, await res.text());
    }
    if (!res.ok) {
      throw new Error(`failed to list models (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as RouteModels[];
  }

  /**
   * Streaming chat request for a model on a specific route. `path` is the
   * provider-specific suffix, e.g. `v1/chat/completions` (OpenAI) or
   * `v1/messages` (Anthropic). Returns the raw SSE Response.
   */
  async chatStream(
    instance: Instance,
    route: string,
    path: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<Response> {
    return this.authed(instance, (token) =>
      fetch(`${instance.gateway}/proxy/${route}/${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: timeoutSignal(signal),
      }),
    );
  }

  /** Run `fn` with a fresh token; on 401, force-refresh once and retry. */
  private async authed(instance: Instance, fn: (token: string) => Promise<Response>): Promise<Response> {
    let token = await this.auth.currentAccessToken(instance);
    let res = await fn(token);
    if (res.status === 401) {
      token = await this.auth.forceRefresh(instance);
      res = await fn(token);
    }
    return res;
  }
}
