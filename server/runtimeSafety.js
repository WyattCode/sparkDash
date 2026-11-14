// Selective adaptation of upstream 54c5f2e / 37d24c8 (Scott Jordan).
// Apache-2.0; see NOTICE and LICENSE-APACHE-2.0.

/** Do not allocate a full JSON snapshot when nobody can receive it. */
export function hasOpenClients(clients) {
  for (const client of clients) if (client.readyState === 1) return true;
  return false;
}

/** A failed bind must not leave a timer-driven but unreachable process alive. */
export function installListenErrorHandler(server, host, port, {
  exit = code => process.exit(code),
  log = message => console.error(message),
  webSocket = null,
} = {}) {
  // ws forwards the HTTP bind error before later HTTP listeners run. Handle
  // that emission so it cannot throw first and bypass our controlled exit.
  webSocket?.on('error', () => log('[sparkDash] WebSocket server error'));
  server.on('error', error => {
    if (server.listening) {
      log('[sparkDash] HTTP server error');
      return;
    }
    log(`[sparkDash] cannot listen on ${host}:${port} (${error?.code || 'unknown'})`);
    exit(1);
  });
}
