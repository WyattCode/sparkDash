import { bandColor } from '../ui/MetricBar';

/** Match the existing node-card temperature bar, including its display-unit band. */
export function temperatureColor(celsius: number, unit: 'celsius' | 'fahrenheit'): string {
  const display = unit === 'fahrenheit' ? Math.round(celsius * 9 / 5 + 32) : celsius;
  const max = unit === 'fahrenheit' ? 212 : 100;
  const base = celsius > 85 ? 'bg-danger' : celsius > 65 ? 'bg-warning' : 'bg-data';
  return bandColor(Math.min(100, Math.round(display / max * 100)), base);
}
