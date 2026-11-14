import { readAccessToken } from '../api/browserStorage';

type State = {id:string;online:boolean};
type Fields = {states?:State[];generatedAt?:number;serverBootId?:string;closeCode?:number;leavingPage?:boolean};
type Event = Fields & {kind:string;clientId:string;browser:string;visibility:string;clientAt:number};
const KEY = 'sparkdash-connectivity-pending-v1';

/** Bounded, same-origin diagnostics; never includes tokens, messages or prompts. */
export function createConnectivityReporter() {
  const clientId = globalThis.crypto?.randomUUID?.() || `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const browser = /Firefox\//.test(navigator.userAgent) ? 'firefox' : /Chrome\//.test(navigator.userAgent) ? 'chromium' : 'other';
  let queue:Event[] = [];
  try { const saved=JSON.parse(sessionStorage.getItem(KEY)||'[]'); if(Array.isArray(saved)) queue=saved.filter(e=>e&&typeof e.kind==='string'&&typeof e.clientId==='string').slice(-64); } catch { /* storage optional */ }
  let busy=false, disposed=false, retry:ReturnType<typeof setTimeout>|undefined;
  const save=()=>{try{sessionStorage.setItem(KEY,JSON.stringify(queue.slice(-64)));}catch{/* bounded in-memory fallback */}};
  async function flush() {
    if (busy || disposed || !queue.length) return;
    clearTimeout(retry);retry=undefined;
    busy=true;
    try {
      while(queue.length && !disposed) {
        const event=queue[0], token=readAccessToken();
        const response=await fetch('/api/connectivity/client-events',{method:'POST',keepalive:true,
          headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
          body:JSON.stringify(event),signal:AbortSignal.timeout(3000)});
        if(disposed) return; // A replacement reporter may already own storage.
        if (!response.ok && response.status!==400) throw Error('unavailable');
        // A malformed old event must not block the rest of the bounded queue.
        if(queue[0]===event) queue.shift();
        save();
      }
    } catch {
      if(!disposed) retry=setTimeout(()=>{retry=undefined;void flush();},5000);
    } finally {busy=false;}
  }
  return {
    record(kind:string,fields:Fields={}) {
      if(disposed)return;
      queue.push({kind,clientId,browser,visibility:document.visibilityState,clientAt:Date.now(),...fields});
      queue=queue.slice(-64);save();void flush();
    },
    dispose(){disposed=true;clearTimeout(retry);save();},
  };
}
