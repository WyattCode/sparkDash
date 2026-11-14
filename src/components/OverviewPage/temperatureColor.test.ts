import { expect, it } from 'vitest';
import { temperatureColor } from './temperatureColor';

it('matches GPU detail Celsius thresholds', () => {
  expect(temperatureColor(45, 'celsius')).toBe('bg-data');
  expect(temperatureColor(61, 'celsius')).toBe('bg-data');
  expect(temperatureColor(66, 'celsius')).toBe('bg-warning');
  expect(temperatureColor(86, 'celsius')).toBe('bg-danger');
});
it('keeps severity independent of display units at every boundary', () => {
  expect(temperatureColor(45, 'fahrenheit')).toBe('bg-data');
  expect(temperatureColor(60, 'fahrenheit')).toBe('bg-data');
  expect(temperatureColor(85, 'fahrenheit')).toBe('bg-warning');
  for (const value of [0, 45, 60, 61, 65, 66, 85, 86, 100]) {
    expect(temperatureColor(value, 'fahrenheit')).toBe(temperatureColor(value, 'celsius'));
  }
});
