/** Match GPU detail thresholds; display units must never change severity. */
export function temperatureColor(celsius: number, _unit: 'celsius' | 'fahrenheit'): string {
  return celsius > 85 ? 'bg-danger' : celsius > 65 ? 'bg-warning' : 'bg-data';
}
