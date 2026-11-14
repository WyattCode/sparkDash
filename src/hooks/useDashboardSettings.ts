import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSettings } from '../api/client';
import type { Settings } from '../api/types';

export function useDashboardSettings(onError: (message: string) => void) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settled, setSettled] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    const requestRevision = ++revision.current;
    const current = () => requestRevision === revision.current;
    fetchSettings().then(value => {
      if (current()) setSettings(value);
    }).catch(error => {
      if (current()) onError(`无法加载设置：${error instanceof Error ? error.message : String(error)}。请重新加载后重试。`);
    }).finally(() => {
      if (current()) setSettled(true);
    });
    return () => { ++revision.current; };
  }, [onError]);

  const acceptSaved = useCallback((value: Settings) => {
    // A confirmed save supersedes every earlier initial read, including errors.
    ++revision.current;
    setSettings(value);
    setSettled(true);
  }, []);
  return { settings, settingsSettled: settled, handleSettingsSaved: acceptSaved };
}
