import { useEffect, useState } from 'react';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// SettingsDialog stays mounted when closed, so we capture the browser event
// before the user opens settings. Never claim installability based on UA alone.
export function usePwaInstall() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const mode = window.matchMedia?.('(display-mode: standalone)');
    setInstalled(mode?.matches ?? false);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
      setMessage('');
    };
    const onInstalled = () => { setInstalled(true); setPrompt(null); setMessage(''); };
    const onMode = () => setInstalled(mode?.matches ?? false);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    mode?.addEventListener?.('change', onMode);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      mode?.removeEventListener?.('change', onMode);
    };
  }, []);

  const install = async () => {
    if (!prompt || busy) return;
    setBusy(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setMessage(choice.outcome === 'accepted' ? '安装请求已提交，请按浏览器提示完成。' : '已取消安装，可稍后从浏览器菜单添加到主屏幕。');
    } catch {
      setMessage('未能打开安装提示，请从浏览器菜单尝试添加到主屏幕。');
    } finally {
      setPrompt(null);
      setBusy(false);
    }
  };
  return { installed, ready: !!prompt, busy, install, message, secure: window.isSecureContext };
}
