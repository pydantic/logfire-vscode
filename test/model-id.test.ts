import { describe, expect, it } from 'vitest';
import { decodeModelId, encodeModelId, isAnthropicProvider } from '../src/gateway/provider';

describe('model id encoding', () => {
  it('round trips', () => {
    const id = encodeModelId('us', 'my-openai', 'gpt-4o');
    expect(id).toBe('us::my-openai::gpt-4o');
    expect(decodeModelId(id)).toEqual({ instanceId: 'us', route: 'my-openai', modelId: 'gpt-4o' });
  });

  it('preserves slashes and colons in the model id', () => {
    const id = encodeModelId('custom:acme', 'anthropic', 'claude-3-5-sonnet/v2');
    expect(decodeModelId(id)).toEqual({
      instanceId: 'custom:acme',
      route: 'anthropic',
      modelId: 'claude-3-5-sonnet/v2',
    });
  });

  it('returns undefined for malformed ids', () => {
    expect(decodeModelId('nope')).toBeUndefined();
    expect(decodeModelId('only::one')).toBeUndefined();
  });
});

describe('isAnthropicProvider', () => {
  it('uses the provider slug when known', () => {
    expect(isAnthropicProvider('anthropic', 'whatever')).toBe(true);
    expect(isAnthropicProvider('openai', 'claude-3')).toBe(false);
  });

  it('falls back to the model id when the provider is unknown', () => {
    expect(isAnthropicProvider(undefined, 'claude-3-5-sonnet')).toBe(true);
    expect(isAnthropicProvider(undefined, 'gpt-4o')).toBe(false);
  });
});
