import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { render } from '../testing/render';
import { readWorkspace, openWorkspace, useWorkspaceRoute } from './useWorkspaceRoute';
import { useRoute } from './useRoute';
import { WorkspaceNav } from '../components/WorkspaceNav';
import { OVERVIEW_ID } from '../constants';
afterEach(()=>{history.replaceState(null,'','/');vi.restoreAllMocks();});
it('accepts known workspaces and safely defaults unknown query values',()=>{
 expect(readWorkspace('?view=service')).toBe('service');expect(readWorkspace('?view=unknown')).toBe('overview');expect(readWorkspace('')).toBe('overview');
});
it('syncs task links, legacy overview navigation and browser history state',()=>{
 vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
 function Harness(){const view=useWorkspaceRoute();const navigate=useRoute(()=>{});return <><WorkspaceNav active={view}/><output>{view}</output><button onClick={()=>navigate(OVERVIEW_ID)}>legacy overview</button></>}
 const {container}=render(<Harness/>);
 act(()=>openWorkspace('service'));expect(container.querySelector('output')?.textContent).toBe('service');expect(location.search).toBe('?view=service');
 act(()=>(container.querySelector('button') as HTMLButtonElement).click());expect(container.querySelector('output')?.textContent).toBe('overview');expect(location.search).toBe('');
 act(()=>{history.replaceState(null,'','/?view=analysis');dispatchEvent(new PopStateEvent('popstate'));});expect(container.querySelector('output')?.textContent).toBe('analysis');
});
it('keeps a running workflow on its current page when navigation is denied',()=>{
 const before=vi.fn(()=>false);const {container}=render(<WorkspaceNav active="tests" beforeNavigate={before}/>);
 act(()=>(container.querySelector('a') as HTMLAnchorElement).click());expect(before).toHaveBeenCalledOnce();expect(location.search).toBe('');
});
