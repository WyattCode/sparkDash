/** Display casing only. Never use for IDs, URLs, selectors or saved settings. */
export function displayName(value: string): string {
  return value.replace(/\bspark(?=-|Dash\b|\b)/g, 'Spark');
}
