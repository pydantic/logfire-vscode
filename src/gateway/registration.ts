import * as vscode from 'vscode';

/**
 * Persistence for RFC 7591 Dynamic Client Registration (DCR).
 *
 * Each Logfire instance the extension talks to gets its own dynamically
 * registered public OAuth client. The full record — including the RFC 7592
 * `registration_access_token` used to later delete the client — is a secret and
 * lives in VSCode SecretStorage. A non-secret summary is mirrored in
 * `globalState` so the "Manage Registered Clients" UI can list registrations
 * without unlocking SecretStorage (which has no enumeration API).
 */

const SECRET_PREFIX = 'logfireGateway.clientRegistration';
const INDEX_KEY = 'logfireGateway.clientRegistrations';

/** A dynamically-registered OAuth client for one instance. */
export interface ClientRegistration {
  instanceId: string;
  instanceLabel: string;
  /** Backend the client was registered against — re-register if it changes. */
  backend: string;
  clientId: string;
  /** RFC 7592 bearer token authorizing DELETE of this client. */
  registrationAccessToken: string;
  /** RFC 7592 client configuration endpoint (`…/api/oauth/register/{client_id}`). */
  registrationClientUri: string;
  /** Scopes the client was registered for, sorted. */
  scopes: string[];
  clientName: string;
  /** Epoch milliseconds. */
  registeredAt: number;
}

/** Non-secret subset persisted in `globalState` for listing in the UI. */
export type RegistrationSummary = Omit<ClientRegistration, 'registrationAccessToken' | 'registrationClientUri'>;

function summarize(reg: ClientRegistration): RegistrationSummary {
  const { registrationAccessToken: _t, registrationClientUri: _u, ...summary } = reg;
  return summary;
}

/** Set equality over scope lists, order-insensitive. */
export function scopesEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(a);
  return b.every((s) => set.has(s));
}

/**
 * Whether a fresh registration is required: no client yet, the backend moved,
 * or the required scope set no longer matches what the client was registered
 * for. Re-registering on a scope change is the mechanism that keeps the issued
 * tokens' grants in sync with what the extension actually needs.
 */
export function needsReregistration(
  existing: ClientRegistration | undefined,
  backend: string,
  requiredScopes: readonly string[],
): boolean {
  return !existing || existing.backend !== backend || !scopesEqual(existing.scopes, requiredScopes);
}

export class RegistrationStore {
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly state: vscode.Memento,
  ) {}

  private secretKey(instanceId: string): string {
    return `${SECRET_PREFIX}.${instanceId}`;
  }

  private index(): Record<string, RegistrationSummary> {
    return this.state.get<Record<string, RegistrationSummary>>(INDEX_KEY, {});
  }

  async get(instanceId: string): Promise<ClientRegistration | undefined> {
    const raw = await this.secrets.get(this.secretKey(instanceId));
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as ClientRegistration;
    } catch {
      // Corrupt entry — treat as absent so the caller re-registers cleanly.
      return undefined;
    }
  }

  async save(reg: ClientRegistration): Promise<void> {
    await this.secrets.store(this.secretKey(reg.instanceId), JSON.stringify(reg));
    await this.state.update(INDEX_KEY, { ...this.index(), [reg.instanceId]: summarize(reg) });
  }

  async delete(instanceId: string): Promise<void> {
    await this.secrets.delete(this.secretKey(instanceId));
    const index = { ...this.index() };
    delete index[instanceId];
    await this.state.update(INDEX_KEY, index);
  }

  /** Non-secret summaries of every registered client, for the management UI. */
  list(): RegistrationSummary[] {
    return Object.values(this.index());
  }
}
