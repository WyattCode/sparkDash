import { useEffect, useState } from 'react';

/** Never flash empty/offline content before the initial responses. Bounded so
 * connection/auth errors remain visible if startup cannot complete. */
export function useStartupPending(hasSnapshot: boolean, settingsSettled: boolean) {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), 5000);
    return () => window.clearTimeout(timer);
  }, []);
  return !timedOut && !(hasSnapshot && settingsSettled);
}
