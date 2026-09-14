import { useCallback, useEffect, useRef, useState } from 'react';
import { listDecodeBench, listPrefillBench, listShowcase } from '../api/client';

export async function checkShowcaseAvailability(sparkId: string): Promise<string | null> {
  // The backend lock is per node, not per port. Do not filter these requests by port.
  const [decode, prefill, showcase] = await Promise.all([listDecodeBench(sparkId), listPrefillBench(sparkId), listShowcase(sparkId)]);
  if (decode.active) return '该节点正在进行解码基准测试，完成后才能启动演示。';
  if (prefill.active) return '该节点正在进行预填充基准测试，完成后才能启动演示。';
  if (showcase.active) return showcase.active.status === 'cancelling'
    ? '该节点的演示正在停止，请等待请求结束后重试。'
    : '该节点已有演示正在运行，请返回原演示窗口查看，或等待完成。';
  return null;
}

export function useShowcaseAvailability(sparkId: string, enabled: boolean) {
  const [message, setMessage] = useState<string | null>('正在检查任务占用…');
  const [checking, setChecking] = useState(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++revision.current;
    setChecking(true);
    try {
      const reason = await checkShowcaseAvailability(sparkId);
      if (ticket === revision.current) setMessage(reason);
    } catch {
      if (ticket === revision.current) setMessage('任务状态暂不可用，请刷新状态后重试。');
    } finally {
      if (ticket === revision.current) setChecking(false);
    }
  }, [sparkId]);
  useEffect(() => {
    if (!enabled) return;
    setMessage('正在检查任务占用…');
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => { ++revision.current; clearInterval(timer); };
  }, [enabled, refresh]);
  return { message, checking, refresh };
}
