import { describe, expect, it } from 'vitest';
import { parsePriceEstimateUsd } from '../src/gateway/statusbar';

describe('parsePriceEstimateUsd', () => {
  it('parses the gateway header value', () => {
    expect(parsePriceEstimateUsd('0.0123USD')).toBe(0.0123);
  });

  it('parses a plain number', () => {
    expect(parsePriceEstimateUsd('1.5')).toBe(1.5);
  });

  it('handles a leading dot', () => {
    expect(parsePriceEstimateUsd('.25USD')).toBe(0.25);
  });

  it('returns undefined for missing or unparseable values', () => {
    expect(parsePriceEstimateUsd(null)).toBeUndefined();
    expect(parsePriceEstimateUsd(undefined)).toBeUndefined();
    expect(parsePriceEstimateUsd('')).toBeUndefined();
    expect(parsePriceEstimateUsd('USD')).toBeUndefined();
  });
});
