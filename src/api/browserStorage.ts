/** Browser storage may throw both on property access and on getItem. */
export function readAccessToken(): string {
  try { return globalThis.localStorage?.getItem('sparkdashToken') || ''; }
  catch { return ''; }
}
