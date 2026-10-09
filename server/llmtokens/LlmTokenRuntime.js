import { extractTokenObservations } from './LlmTokenLedger.js';

export function createLlmTokenRuntime({ledger,orderedSnapshots,setIntervalFn=setInterval,clearIntervalFn=clearInterval}) {
  let timer=null,stopped=false,ticks=0;
  const sample=()=>{
    const now=Date.now();
    try {ledger.record(extractTokenObservations(orderedSnapshots(),now),now);
      if(++ticks%2===0)ledger.flush();
    }catch(e){console.error('[LlmTokenLedger]',e.message);}
  };
  return {
    start(){if(timer||stopped)return;sample();timer=setIntervalFn(sample,15000);timer?.unref?.();},
    stop(){if(stopped)return;stopped=true;if(timer)clearIntervalFn(timer);ledger.flush();},
  };
}
