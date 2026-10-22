// Local read-only integration of the Apache-2.0 upstream RoceSampler; see NOTICE.
import { RoceSampler } from './collectors/roce.js';
import { SystemCollector } from './collectors/SystemCollector.js';
import { sshExec } from './collectors/ssh.js';

/** No background sampling: only an expanded node panel requests these facts. */
export function registerRoceRoutes(app, registry, {
  run = (spark,script) => spark.isLocal
    ? new SystemCollector(spark)._execOnHost(script)
    : sshExec(spark,script,{timeoutMs:8000}),
  now = Date.now,
} = {}) {
  const samplers=new Map();
  registry.onChange((action,spark)=>{
    if(action==='reorder')return;
    if(spark?.id)samplers.delete(spark.id);
    else samplers.clear();
  });
  app.get('/api/sparks/:id/roce',async(req,res)=>{
    const spark=registry.getSpark(req.params.id);
    if(!spark)return res.status(404).json({error:'节点不存在'});
    let sampler=samplers.get(spark.id);
    if(!sampler){sampler=new RoceSampler({run:script=>{
      if(samplers.get(spark.id)!==sampler)throw new Error('Node configuration changed');
      const current=registry.getSpark(spark.id);
      if(!current)throw new Error('Node removed');
      return run(current,script);
    },now});samplers.set(spark.id,sampler);}
    try {
      const result=await sampler.sample();
      if(samplers.get(spark.id)!==sampler)return res.status(409).json({error:'节点配置已变化，请重新读取互联数据。'});
      if(!result&&sampler.readFailed)throw new Error('Read unavailable');
      const age=result ? now()-result.sampledAt : null;
      res.json({available:!!result,stale:sampler.readFailed||age!=null&&(age<0||age>30000),sampledAt:result?.sampledAt??null,devices:result?.devices??[]});
    }catch {
      if(samplers.get(spark.id)!==sampler)return res.status(409).json({error:'节点配置已变化，请重新读取互联数据。'});
      res.status(503).json({error:'高速互联数据暂不可用；未更改任何网络配置。'});
    }
  });
}
