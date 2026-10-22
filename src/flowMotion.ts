/** One observer for all bars; no timers or per-frame JS. */
export function installFlowMotion(root: HTMLElement = document.documentElement) {
  const selector='.metric-bar-fill,.comparison-metric__track > span';
  const tracked=new Set<Element>();
  const visibility=()=>root.classList.toggle('flow-page-hidden',document.hidden);
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{
    for(const entry of entries) entry.target.classList.toggle('flow-visible',entry.isIntersecting);
  });
  const visit=(node:Node, add:boolean)=>{
    if(!(node instanceof Element))return;
    const elements=[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)];
    for(const element of elements){
      if(add&&!tracked.has(element)){tracked.add(element);observer?.observe(element);}
      else if(!add&&tracked.delete(element)){observer?.unobserve(element);element.classList.remove('flow-visible');}
    }
  };
  const mutations=new MutationObserver(records=>{
    for(const record of records){
      for(const node of record.removedNodes)visit(node,false);
      for(const node of record.addedNodes)visit(node,true);
    }
  });
  if(observer){root.classList.add('flow-managed');visit(root,true);mutations.observe(root,{childList:true,subtree:true});}
  document.addEventListener('visibilitychange',visibility);visibility();
  return ()=>{
    mutations.disconnect();observer?.disconnect();
    document.removeEventListener('visibilitychange',visibility);
    root.classList.remove('flow-managed','flow-page-hidden');
    for(const element of tracked)element.classList.remove('flow-visible');
    tracked.clear();
  };
}
