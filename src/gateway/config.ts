import * as vscode from 'vscode';

/**
 * A Logfire deployment the extension can talk to. Multiple instances can be
 * active at once — built-in hosted regions plus any number of self-hosted
 * instances, each identified by an alias.
 *
 * The OAuth client is a public client identified by a CIMD (Client ID Metadata
 * Document) URL, derived from the backend host (see `cimdClientId`), so the
 * loopback redirect is allowed without per-instance registration.
 */
export interface Instance {
  /** Stable key, e.g. `us`, `eu`, `stagingeu`, or `custom:acme-prod`. */
  id: string;
  /** Human label shown in the picker, e.g. `US`, `EU`, or the alias. */
  label: string;
  backend: string;
  gateway: string;
  clientId: string;
  /** RFC 8707 resource indicator: `{gateway}/proxy`. */
  resource: string;
  builtin: boolean;
}

interface RegionPreset {
  label: string;
  backend: string;
  gateway: string;
}

const REGION_PRESETS: Record<string, RegionPreset> = {
  us: { label: 'US', backend: 'https://logfire-us.pydantic.dev', gateway: 'https://gateway-us.pydantic.dev' },
  eu: { label: 'EU', backend: 'https://logfire-eu.pydantic.dev', gateway: 'https://gateway-eu.pydantic.dev' },
  stagingeu: {
    label: 'Staging EU',
    backend: 'https://logfire-eu.pydantic.info',
    gateway: 'https://gateway.pydantic.info',
  },
};

/** OAuth scope the gateway requires on issued tokens. */
export const SCOPE = 'project:gateway_proxy';

const CIMD_PATH = '/clients/logfire-gateway.json';

/**
 * Canonical hosted CIMD document, used as the fallback `client_id` for any
 * deployment that can't serve its own valid CIMD doc — i.e. self-hosted /
 * localhost backends. Those are served over `http` and/or on a loopback
 * address, both of which the authorization server's CIMD validation rejects
 * (it requires `https` and refuses private/loopback IPs for SSRF reasons).
 *
 * A CIMD `client_id` is just a metadata-document URL the auth server fetches;
 * it need not live on the same host as the auth server. So the hosted doc
 * works as the client identity against *any* backend that has outbound access
 * to `logfire.pydantic.dev` — including a localhost dev stack. Set an explicit
 * `clientId` on a `logfireGateway.instances` entry to override this.
 */
export const DEFAULT_CIMD_CLIENT_ID = `https://logfire.pydantic.dev${CIMD_PATH}`;

/**
 * Derive the CIMD client-id URL from a backend host:
 * - `logfire-*.pydantic.dev`  -> `https://logfire.pydantic.dev{CIMD_PATH}`
 * - `logfire-*.pydantic.info` -> `https://logfire.pydantic.info{CIMD_PATH}`
 * - anything else (self-hosted/localhost) -> `DEFAULT_CIMD_CLIENT_ID`
 *
 * Self-hosted backends fall back to the hosted doc because their own derived
 * URL (`http://…`/loopback) would be rejected by the auth server's CIMD check.
 */
export function cimdClientId(backend: string): string {
  let url: URL;
  try {
    url = new URL(backend);
  } catch {
    return DEFAULT_CIMD_CLIENT_ID;
  }
  const host = url.hostname;
  if (host.startsWith('logfire-') && host.endsWith('.pydantic.dev')) {
    return `${url.protocol}//logfire.pydantic.dev${CIMD_PATH}`;
  }
  if (host.startsWith('logfire-') && host.endsWith('.pydantic.info')) {
    return `${url.protocol}//logfire.pydantic.info${CIMD_PATH}`;
  }
  return DEFAULT_CIMD_CLIENT_ID;
}

interface CustomInstanceConfig {
  alias?: string;
  /** Base URL serving both OAuth and the gateway, unless split below. */
  url?: string;
  backendUrl?: string;
  gatewayUrl?: string;
  /**
   * CIMD client_id URL to authenticate as. Optional — when omitted, the
   * hosted `DEFAULT_CIMD_CLIENT_ID` is used (self-hosted/localhost backends
   * can't serve a CIMD doc the auth server will accept).
   */
  clientId?: string;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function slug(alias: string): string {
  return alias
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function makeInstance(
  id: string,
  label: string,
  backend: string,
  gateway: string,
  builtin: boolean,
  clientId?: string,
): Instance {
  return {
    id,
    label,
    backend,
    gateway,
    clientId: clientId || cimdClientId(backend),
    resource: `${gateway}/proxy`,
    builtin,
  };
}

/**
 * All configured instances: the hosted regions selected in
 * `logfireGateway.regions` (default US + EU) plus self-hosted entries from
 * `logfireGateway.instances`. Invalid/incomplete entries are skipped.
 */
export function listInstances(): Instance[] {
  const cfg = vscode.workspace.getConfiguration('logfireGateway');
  const out: Instance[] = [];
  const seen = new Set<string>();

  const regions = cfg.get<string[]>('regions', ['us', 'eu']);
  for (const r of regions) {
    const preset = REGION_PRESETS[r];
    if (preset && !seen.has(r)) {
      out.push(makeInstance(r, preset.label, preset.backend, preset.gateway, true));
      seen.add(r);
    }
  }

  const custom = cfg.get<CustomInstanceConfig[]>('instances', []);
  for (const c of custom) {
    const alias = (c.alias ?? '').trim();
    const base = trimSlash(c.url ?? '');
    const backend = trimSlash(c.backendUrl || base);
    const gateway = trimSlash(c.gatewayUrl || base);
    if (!alias || !backend || !gateway) {
      continue; // incomplete entry — needs an alias and at least one URL
    }
    const id = `custom:${slug(alias) || backend}`;
    if (seen.has(id)) {
      continue;
    }
    const clientId = trimSlash(c.clientId ?? '') || undefined;
    out.push(makeInstance(id, alias, backend, gateway, false, clientId));
    seen.add(id);
  }

  return out;
}

export function requestTimeoutMs(): number {
  return vscode.workspace.getConfiguration('logfireGateway').get<number>('requestTimeoutMs', 180000);
}

export interface ModelOverride {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  toolCalling?: boolean;
  imageInput?: boolean;
  family?: string;
}

/** Overrides keyed by bare model id or by the namespaced `instance::route::model` id. */
export function modelOverrides(): Record<string, ModelOverride> {
  return vscode.workspace.getConfiguration('logfireGateway').get('modelOverrides', {});
}
