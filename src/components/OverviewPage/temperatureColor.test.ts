import { expect, it } from 'vitest';
import { temperatureColor } from './temperatureColor';

it('matches the existing Celsius node-card bands', () => {
  expect(temperatureColor(45, 'celsius')).toBe('bg-data');
  expect(temperatureColor(61, 'celsius')).toBe('bg-warning');
  expect(temperatureColor(86, 'celsius')).toBe('bg-danger');
});
it('preserves the existing Fahrenheit node-card bands', () => {
  expect(temperatureColor(45, 'fahrenheit')).toBe('bg-data');
  expect(temperatureColor(60, 'fahrenheit')).toBe('bg-warning');
  expect(temperatureColor(85, 'fahrenheit')).toBe('bg-danger');
});
