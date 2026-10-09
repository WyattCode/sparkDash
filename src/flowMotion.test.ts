import {expect,it,vi} from 'vitest';
import {installFlowMotion} from './flowMotion';
it('observes new bars, pauses by visibility and releases all observers',async()=>{
 let notify!:IntersectionObserverCallback;
 const observe=vi.fn(),unobserve=vi.fn(),disconnect=vi.fn();
 vi.stubGlobal('IntersectionObserver',class {constructor(cb:IntersectionObserverCallback){notify=cb;}observe=observe;unobserve=unobserve;disconnect=disconnect;});
 const root=document.createElement('div');document.body.append(root);
 const stop=installFlowMotion(root);
 try {
  const bar=document.createElement('div');bar.className='metric-bar-fill';root.append(bar);
  await Promise.resolve();expect(observe).toHaveBeenCalledWith(bar);
  notify([{target:bar,isIntersecting:true,intersectionRect:{width:100}}] as unknown as IntersectionObserverEntry[],{} as IntersectionObserver);
  expect(bar.classList.contains('flow-visible')).toBe(true);
  notify([{target:bar,isIntersecting:false,intersectionRect:{width:0}}] as unknown as IntersectionObserverEntry[],{} as IntersectionObserver);
  expect(bar.classList.contains('flow-visible')).toBe(false);
  const hidden=vi.spyOn(document,'hidden','get').mockReturnValue(true);
  document.dispatchEvent(new Event('visibilitychange'));expect(root.classList.contains('flow-page-hidden')).toBe(true);
  hidden.mockRestore();bar.remove();await Promise.resolve();expect(unobserve).toHaveBeenCalledWith(bar);
 } finally {stop();root.remove();vi.unstubAllGlobals();}
 expect(disconnect).toHaveBeenCalled();expect(root.classList.contains('flow-managed')).toBe(false);
});
