import { WORKSPACES, workspaceHref, openWorkspace, type Workspace } from '../hooks/useWorkspaceRoute';
import { useEffect, useRef } from 'react';

export function WorkspaceNav({ active, beforeNavigate }: { active: Workspace; beforeNavigate?: () => boolean }) {
  const ref=useRef<HTMLElement>(null);
  useEffect(()=>{
    const nav=ref.current,current=nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if(!nav||!current)return;
    // Reveal the selected destination without moving the page vertically.
    const reveal=()=>{
      const outer=nav.getBoundingClientRect(),inner=current.getBoundingClientRect();
      if(inner.left<outer.left)nav.scrollLeft-=outer.left-inner.left;
      else if(inner.right>outer.right)nav.scrollLeft+=inner.right-outer.right;
    };
    reveal();window.addEventListener('resize',reveal);
    return()=>window.removeEventListener('resize',reveal);
  },[active]);
  return <nav ref={ref} className="workspace-nav" aria-label="工作区">{WORKSPACES.map(([id, label]) => <a key={id} href={workspaceHref(id)} aria-current={active === id ? 'page' : undefined} onClick={e => {
    if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); if(beforeNavigate && !beforeNavigate()) return; openWorkspace(id); }
  }}>{label}</a>)}</nav>;
}
