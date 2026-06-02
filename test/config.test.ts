import { beforeEach, describe, expect, it } from 'vitest';
import { cimdClientId, DEFAULT_CIMD_CLIENT_ID, listInstances } from '../src/gateway/config';
import { __resetConfig, __setConfig } from './vscode-mock';

beforeEach(() => __resetConfig());

describe('cimdClientId', () => {
  it('derives the hosted .dev document', () => {
    expect(cimdClientId('https://logfire-us.pydantic.dev')).toBe(
      'https://logfire.pydantic.dev/clients/logfire-gateway.json',
    );
  });
  it('derives the hosted .info document', () => {
    expect(cimdClientId('https://logfire-eu.pydantic.info')).toBe(
      'https://logfire.pydantic.info/clients/logfire-gateway.json',
    );
  });
  it('falls back to the hosted doc for self-hosted https hosts', () => {
    expect(cimdClientId('https://logfire.acme.com')).toBe(DEFAULT_CIMD_CLIENT_ID);
  });
  it('falls back for http/localhost', () => {
    expect(cimdClientId('http://localhost:3000')).toBe(DEFAULT_CIMD_CLIENT_ID);
  });
  it('falls back for an invalid url', () => {
    expect(cimdClientId('not a url')).toBe(DEFAULT_CIMD_CLIENT_ID);
  });
});

describe('listInstances', () => {
  it('defaults to US + EU', () => {
    expect(listInstances().map((i) => i.id)).toEqual(['us', 'eu']);
  });

  it('honors the regions setting', () => {
    __setConfig({ 'logfireGateway.regions': ['eu'] });
    expect(listInstances().map((i) => i.id)).toEqual(['eu']);
  });

  it('builds a custom instance from an alias + url', () => {
    __setConfig({
      'logfireGateway.regions': [],
      'logfireGateway.instances': [{ alias: 'Acme Prod', url: 'https://logfire.acme.com/' }],
    });
    const [i] = listInstances();
    expect(i.id).toBe('custom:acme-prod');
    expect(i.label).toBe('Acme Prod');
    expect(i.backend).toBe('https://logfire.acme.com');
    expect(i.gateway).toBe('https://logfire.acme.com');
    expect(i.resource).toBe('https://logfire.acme.com/proxy');
    expect(i.clientId).toBe(DEFAULT_CIMD_CLIENT_ID);
    expect(i.builtin).toBe(false);
  });

  it('honors split backend/gateway and explicit clientId', () => {
    __setConfig({
      'logfireGateway.regions': [],
      'logfireGateway.instances': [
        {
          alias: 'Lab',
          backendUrl: 'https://auth.lab',
          gatewayUrl: 'https://gw.lab',
          clientId: 'https://lab/clients/x.json',
        },
      ],
    });
    const [i] = listInstances();
    expect(i.backend).toBe('https://auth.lab');
    expect(i.gateway).toBe('https://gw.lab');
    expect(i.clientId).toBe('https://lab/clients/x.json');
  });

  it('skips incomplete custom entries', () => {
    __setConfig({
      'logfireGateway.regions': [],
      'logfireGateway.instances': [{ alias: 'NoUrl' }, { url: 'https://x' }],
    });
    expect(listInstances()).toHaveLength(0);
  });

  it('dedupes regions and aliases', () => {
    __setConfig({
      'logfireGateway.regions': ['us', 'us'],
      'logfireGateway.instances': [
        { alias: 'A', url: 'https://a' },
        { alias: 'A', url: 'https://b' },
      ],
    });
    expect(listInstances().map((i) => i.id)).toEqual(['us', 'custom:a']);
  });
});
