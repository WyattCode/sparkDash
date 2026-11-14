import { expect, it } from 'vitest';
import { displayName } from './displayName';
it('capitalizes display names without uppercasing their suffix', () => {
  expect(displayName('spark-ffda')).toBe('Spark-ffda');
  expect(displayName('sparkDash')).toBe('SparkDash');
  expect(displayName('DGX Spark')).toBe('DGX Spark');
  expect(displayName('sparks')).toBe('sparks');
});
