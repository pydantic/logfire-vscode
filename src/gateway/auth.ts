import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as http from 'http';
import { AddressInfo } from 'net';
import { Instance, REQUIRED_SCOPES, requestTimeoutMs, SCOPE } from './config';
import { ClientRegistration, needsReregistration, RegistrationStore, RegistrationSummary } from './registration';

/**
 * OAuth client for the Logfire AI Gateway, scoped per instance.
 *
 * The client is established via RFC 7591 Dynamic Client Registration: at
 * sign-in the extension registers a public OAuth client for the instance and
 * persists the issued `client_id` (and RFC 7592 management token). The client
 * is re-registered automatically whenever the required scope set changes. If an
 * instance configures a static `clientId`, that client id is used directly and
 * DCR is skipped (the client isn't tracked in the registration store).
 *
 * Flow: authorization-code + PKCE (S256) with a loopback redirect (RFC 8252).
 * Tokens are short-lived; each instance's refresh token is persisted in VSCode
 * SecretStorage under its own key, so several instances (US, EU, self-hosted)
 * can be signed in at the same time.
 */

const REFRESH_MARGIN_SECONDS = 120;
const SECRET_PREFIX = 'logfireGateway.refreshToken';
const CLIENT_NAME = 'Logfire AI Gateway (VS Code)';
/** Loopback redirect registered with the AS; the port varies per sign-in and
 * is ignored for loopback hosts per RFC 8252 §7.3, so a port-less value is the
 * stable thing to register. */
const REGISTERED_REDIRECT_URI = 'http://127.0.0.1/callback';

interface OAuthMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
}

/** RFC 7591 client information response (subset we consume). */
interface DCRResponse {
  client_id: string;
  registration_access_token: string;
  registration_client_uri: string;
  scope?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

interface TokenState {
  accessToken?: string;
  refreshToken?: string;
  expiresAt: number;
  inflight?: Promise<string>;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** GET {backend}/.well-known/oauth-authorization-server */
async function discover(backend: string): Promise<OAuthMetadata> {
  const url = `${backend.replace(/\/+$/, '')}/.well-known/oauth-authorization-server`;
  const res = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs()) });
  if (!res.ok) {
    throw new Error(`OAuth discovery failed (${res.status}): ${url}`);
  }
  const body = (await res.json()) as OAuthMetadata;
  if (!body.authorization_endpoint || !body.token_endpoint) {
    throw new Error(`OAuth discovery missing endpoints in ${url}`);
  }
  return body;
}

export class GatewayAuth {
  private readonly states = new Map<string, TokenState>();

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly registrations: RegistrationStore,
  ) {}

  private secretKey(instance: Instance): string {
    return this.secretKeyForId(instance.id);
  }

  private secretKeyForId(instanceId: string): string {
    return `${SECRET_PREFIX}.${instanceId}`;
  }

  private state(instance: Instance): TokenState {
    let s = this.states.get(instance.id);
    if (!s) {
      s = { expiresAt: 0 };
      this.states.set(instance.id, s);
    }
    return s;
  }

  /** Drop the in-memory token cache (e.g. on a settings change). */
  reset(): void {
    this.states.clear();
  }

  async isSignedIn(instance: Instance): Promise<boolean> {
    return Boolean(await this.secrets.get(this.secretKey(instance)));
  }

  /** Interactive sign-in for one instance. */
  async signIn(instance: Instance): Promise<void> {
    this.states.delete(instance.id);
    const metadata = await discover(instance.backend);
    const clientId = await this.resolveClientId(instance, metadata);
    const { verifier, challenge } = pkcePair();
    const state = b64url(crypto.randomBytes(32));
    const { code, redirectUri } = await this.runLoopbackAuthorize(instance, clientId, metadata, challenge, state);

    const token = await this.postToken(metadata, {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: instance.resource,
    });
    await this.store(instance, token);
  }

  async signOut(instance: Instance): Promise<void> {
    this.states.delete(instance.id);
    await this.secrets.delete(this.secretKey(instance));
  }

  /** Non-secret summaries of every dynamically-registered client. */
  listRegistrations(): RegistrationSummary[] {
    return this.registrations.list();
  }

  /**
   * Unregister a dynamically-registered client (RFC 7592 DELETE) and, per the
   * requirement that an unregistered client must not leave a usable session
   * behind, always remove its stored refresh token and local registration —
   * even if the server-side delete can't be confirmed (e.g. offline).
   *
   * Returns whether the server acknowledged the deletion.
   */
  async unregisterClient(instanceId: string): Promise<{ serverDeleted: boolean }> {
    const registration = await this.registrations.get(instanceId);
    let serverDeleted = false;
    if (registration) {
      try {
        const res = await fetch(registration.registrationClientUri, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${registration.registrationAccessToken}` },
          signal: AbortSignal.timeout(requestTimeoutMs()),
        });
        // 204 = deleted; 401 = client/token already gone — both mean "no client left".
        serverDeleted = res.ok || res.status === 401;
      } catch {
        // Best-effort: a network failure must not block local cleanup below.
      }
    }
    this.states.delete(instanceId);
    await this.secrets.delete(this.secretKeyForId(instanceId));
    await this.registrations.delete(instanceId);
    return { serverDeleted };
  }

  /**
   * The OAuth client_id to authorize with: a user-provided static client id when
   * the instance has one (skipping DCR entirely), otherwise the client_id of a
   * dynamically-registered client (registering or re-registering as needed).
   */
  private async resolveClientId(instance: Instance, metadata: OAuthMetadata): Promise<string> {
    if (instance.staticClientId) {
      return instance.staticClientId;
    }
    return (await this.ensureRegisteredClient(instance, metadata)).clientId;
  }

  /**
   * Return a registered client for the instance, registering (or re-registering
   * on a backend/scope change) as needed. A re-registration invalidates any
   * previous client and its tokens, so the old refresh token is cleared and the
   * user is prompted to sign in again.
   */
  private async ensureRegisteredClient(instance: Instance, metadata: OAuthMetadata): Promise<ClientRegistration> {
    const existing = await this.registrations.get(instance.id);
    if (!needsReregistration(existing, instance.backend, REQUIRED_SCOPES)) {
      return existing as ClientRegistration;
    }
    if (existing) {
      // Replacing the client: drop the now-stale session before swapping it.
      await this.unregisterClient(instance.id);
    }
    return this.registerClient(instance, metadata);
  }

  /** RFC 7591 Dynamic Client Registration of a public (PKCE) client. */
  private async registerClient(instance: Instance, metadata: OAuthMetadata): Promise<ClientRegistration> {
    if (!metadata.registration_endpoint) {
      throw new Error(
        `${instance.label} does not support dynamic client registration (no registration_endpoint). Upgrade Logfire.`,
      );
    }
    const res = await fetch(metadata.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        redirect_uris: [REGISTERED_REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'native',
        scope: SCOPE,
      }),
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });
    if (!res.ok) {
      throw new Error(`client registration failed (${res.status}): ${await res.text()}`);
    }
    const body = (await res.json()) as DCRResponse;
    if (!body.client_id || !body.registration_access_token || !body.registration_client_uri) {
      throw new Error('client registration response missing client_id / registration fields');
    }
    const registration: ClientRegistration = {
      instanceId: instance.id,
      instanceLabel: instance.label,
      backend: instance.backend,
      clientId: body.client_id,
      registrationAccessToken: body.registration_access_token,
      registrationClientUri: body.registration_client_uri,
      scopes: [...REQUIRED_SCOPES].sort(),
      clientName: CLIENT_NAME,
      registeredAt: Date.now(),
    };
    await this.registrations.save(registration);
    return registration;
  }

  /** The current client_id for an instance, or throw if not registered. */
  private async clientId(instance: Instance): Promise<string> {
    if (instance.staticClientId) {
      return instance.staticClientId;
    }
    const registration = await this.registrations.get(instance.id);
    if (!registration) {
      throw new vscode.LanguageModelError(`Not signed in to ${instance.label}. Run "Logfire AI Gateway: Sign In".`);
    }
    return registration.clientId;
  }

  /** Returns a valid access token for the instance, refreshing as needed. */
  async currentAccessToken(instance: Instance): Promise<string> {
    const s = this.state(instance);
    if (s.inflight) {
      return s.inflight;
    }
    s.inflight = this.acquire(instance).finally(() => {
      s.inflight = undefined;
    });
    return s.inflight;
  }

  /** Force a refresh after the gateway rejects a token with 401. */
  async forceRefresh(instance: Instance): Promise<string> {
    const metadata = await discover(instance.backend);
    await this.refresh(instance, metadata);
    const token = this.state(instance).accessToken;
    if (!token) {
      throw new Error('refresh did not return an access token');
    }
    return token;
  }

  private async acquire(instance: Instance): Promise<string> {
    const s = this.state(instance);
    if (!s.refreshToken) {
      s.refreshToken = await this.secrets.get(this.secretKey(instance));
    }
    const now = Date.now() / 1000;
    if (s.accessToken && s.expiresAt - now >= REFRESH_MARGIN_SECONDS) {
      return s.accessToken;
    }
    if (!s.refreshToken) {
      throw new vscode.LanguageModelError(`Not signed in to ${instance.label}. Run "Logfire AI Gateway: Sign In".`);
    }
    const metadata = await discover(instance.backend);
    try {
      await this.refresh(instance, metadata);
    } catch (err) {
      if (now >= s.expiresAt) {
        throw err;
      }
    }
    if (!s.accessToken) {
      throw new Error('no access token after refresh');
    }
    return s.accessToken;
  }

  private async refresh(instance: Instance, metadata: OAuthMetadata): Promise<void> {
    const s = this.state(instance);
    if (!s.refreshToken) {
      s.refreshToken = await this.secrets.get(this.secretKey(instance));
    }
    if (!s.refreshToken) {
      throw new Error('no refresh token; reauthorize');
    }
    const token = await this.postToken(metadata, {
      grant_type: 'refresh_token',
      refresh_token: s.refreshToken,
      client_id: await this.clientId(instance),
      resource: instance.resource,
    });
    await this.store(instance, token);
  }

  private async postToken(metadata: OAuthMetadata, form: Record<string, string>): Promise<TokenResponse> {
    const res = await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });
    if (!res.ok) {
      throw new Error(`token request failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as TokenResponse;
  }

  private async store(instance: Instance, token: TokenResponse): Promise<void> {
    const s = this.state(instance);
    s.accessToken = token.access_token;
    if (token.refresh_token) {
      s.refreshToken = token.refresh_token;
      await this.secrets.store(this.secretKey(instance), token.refresh_token);
    }
    s.expiresAt = Date.now() / 1000 + (token.expires_in ?? 3600);
  }

  /**
   * Spin up a one-shot loopback server (RFC 8252), open the system browser to
   * the authorization endpoint, and resolve with the returned code. Uses
   * vscode.env.openExternal so it works in remote/web hosts too.
   */
  private runLoopbackAuthorize(
    instance: Instance,
    clientId: string,
    metadata: OAuthMetadata,
    challenge: string,
    state: string,
  ): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1');
          if (url.pathname !== '/callback') {
            res.writeHead(404).end();
            return;
          }
          const error = url.searchParams.get('error');
          const code = url.searchParams.get('code');
          const returnedState = url.searchParams.get('state');
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end(
            '<!doctype html><title>Logfire Gateway</title>' +
              `<h1>${error ? 'Authorization failed' : 'Authorized'}</h1>` +
              '<p>You can close this tab and return to VSCode.</p>',
          );
          server.close();
          if (error) {
            reject(new Error(`authorization failed: ${error}`));
          } else if (!code || returnedState !== state) {
            reject(new Error('invalid or missing code/state'));
          } else {
            resolve({ code, redirectUri });
          }
        } catch (e) {
          reject(e as Error);
        }
      });

      let redirectUri = '';
      server.listen(0, '127.0.0.1', async () => {
        const port = (server.address() as AddressInfo).port;
        redirectUri = `http://127.0.0.1:${port}/callback`;
        const params = new URLSearchParams({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: SCOPE,
          state,
          resource: instance.resource,
          code_challenge: challenge,
          code_challenge_method: 'S256',
        });
        const authorizeUrl = `${metadata.authorization_endpoint}?${params.toString()}`;
        const opened = await vscode.env.openExternal(vscode.Uri.parse(authorizeUrl));
        if (!opened) {
          server.close();
          reject(new Error('failed to open browser for authorization'));
        }
      });

      setTimeout(() => {
        server.close();
        reject(new Error('authorization timed out'));
      }, 600_000).unref?.();
    });
  }
}
