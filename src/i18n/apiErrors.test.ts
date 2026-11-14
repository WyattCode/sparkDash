import { describe, expect, it } from 'vitest';
import { translateApiError } from './apiErrors';

describe('API error localization', () => {
  it('explains the decode lock without suggesting automatic cancellation', () => {
    expect(translateApiError('A decode benchmark is already running for this Spark')).toContain('解码基准测试');
  });
  it('translates missing records used by benchmark polling', () => {
    expect(translateApiError('Benchmark not found')).toBe('找不到基准测试记录');
  });
  it('preserves unknown upstream diagnostics and model content', () => {
    expect(translateApiError('upstream: custom diagnostic 123')).toBe('upstream: custom diagnostic 123');
  });
});
