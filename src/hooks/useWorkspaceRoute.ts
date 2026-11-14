import { useEffect, useState } from 'react';

export const WORKSPACES = [
  ['overview', '概览'], ['service', '模型服务'], ['nodes', '节点监控'],
  ['tests', '测试工具'], ['analysis', '运行分析'], ['diagnostics', '诊断'],
] as const;
export type Workspace = typeof WORKSPACES[number][0];
export function readWorkspace(search = window.location.search): Workspace {
  const value = new URLSearchParams(search).get('view');
  return WORKSPACES.find(([id]) => id === value)?.[0] ?? 'overview';
}
export function workspaceHref(view: Workspace): string { return view === 'overview' ? '/' : '/?view=' + view; }
export function openWorkspace(view: Workspace) {
  const url = workspaceHref(view);
  if (location.pathname + location.search !== url) history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}
export function useWorkspaceRoute(): Workspace {
  const [view, setView] = useState(readWorkspace);
  useEffect(() => { const update = () => setView(readWorkspace()); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, []);
  return view;
}
