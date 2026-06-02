import { beforeEach, describe, expect, it } from 'vitest';
import { ClientRegistration, needsReregistration, RegistrationStore, scopesEqual } from '../src/gateway/registration';

type StoreCtor = ConstructorParameters<typeof RegistrationStore>;

/** In-memory SecretStorage stand-in (only the methods the store touches). */
function fakeSecrets(): StoreCtor[0] {
  const map = new Map<string, string>();
  return {
    get: async (k: string) => map.get(k),
    store: async (k: string, v: string) => void map.set(k, v),
    delete: async (k: string) => void map.delete(k),
  } as unknown as StoreCtor[0];
}

/** In-memory Memento stand-in for globalState. */
function fakeState(): StoreCtor[1] {
  const map = new Map<string, unknown>();
  return {
    get: <T>(k: string, def?: T) => (map.has(k) ? (map.get(k) as T) : (def as T)),
    update: async (k: string, v: unknown) => void map.set(k, v),
  } as unknown as StoreCtor[1];
}

function reg(overrides: Partial<ClientRegistration> = {}): ClientRegistration {
  return {
    instanceId: 'us',
    instanceLabel: 'US',
    backend: 'https://logfire-us.pydantic.dev',
    clientId: 'lf_dcr_abc',
    registrationAccessToken: 'pylf_ra_us_secret',
    registrationClientUri: 'https://logfire-us.pydantic.dev/api/oauth/register/lf_dcr_abc',
    scopes: ['project:gateway_proxy'],
    clientName: 'Logfire AI Gateway (VS Code)',
    registeredAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('scopesEqual', () => {
  it('is order-insensitive', () => {
    expect(scopesEqual(['a', 'b'], ['b', 'a'])).toBe(true);
  });
  it('detects differing length', () => {
    expect(scopesEqual(['a'], ['a', 'b'])).toBe(false);
  });
  it('detects differing members', () => {
    expect(scopesEqual(['a', 'b'], ['a', 'c'])).toBe(false);
  });
});

describe('needsReregistration', () => {
  const scopes = ['project:gateway_proxy'];
  it('is true when nothing is registered yet', () => {
    expect(needsReregistration(undefined, 'https://logfire-us.pydantic.dev', scopes)).toBe(true);
  });
  it('is true when the backend changed', () => {
    expect(needsReregistration(reg(), 'https://logfire-eu.pydantic.dev', scopes)).toBe(true);
  });
  it('is true when the required scopes changed', () => {
    expect(
      needsReregistration(reg(), 'https://logfire-us.pydantic.dev', ['project:gateway_proxy', 'project:read']),
    ).toBe(true);
  });
  it('is false when backend and scopes match', () => {
    expect(needsReregistration(reg(), 'https://logfire-us.pydantic.dev', scopes)).toBe(false);
  });
});

describe('RegistrationStore', () => {
  let store: RegistrationStore;
  beforeEach(() => {
    store = new RegistrationStore(fakeSecrets(), fakeState());
  });

  it('round-trips the full record through SecretStorage', async () => {
    await store.save(reg());
    expect(await store.get('us')).toEqual(reg());
  });

  it('lists non-secret summaries only (no registration token / uri)', async () => {
    await store.save(reg());
    const [summary] = store.list();
    expect(summary).toEqual({
      instanceId: 'us',
      instanceLabel: 'US',
      backend: 'https://logfire-us.pydantic.dev',
      clientId: 'lf_dcr_abc',
      scopes: ['project:gateway_proxy'],
      clientName: 'Logfire AI Gateway (VS Code)',
      registeredAt: 1_700_000_000_000,
    });
    expect(summary).not.toHaveProperty('registrationAccessToken');
    expect(summary).not.toHaveProperty('registrationClientUri');
  });

  it('delete removes the record from both get and list', async () => {
    await store.save(reg());
    await store.save(reg({ instanceId: 'eu', instanceLabel: 'EU' }));
    await store.delete('us');
    expect(await store.get('us')).toBeUndefined();
    expect(store.list().map((s) => s.instanceId)).toEqual(['eu']);
  });
});
