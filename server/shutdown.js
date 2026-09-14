import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export const SHUTDOWN_BIN = '/usr/local/bin/spark-shutdown';
export function createShutdownLock() {
  const pending=new Set();
  return async function withLock(ids,action) {
    const targets=[...new Set(ids)];
    if(targets.some(id=>pending.has(id)))throw Object.assign(new Error('相关节点已有电源操作正在处理，请先确认结果，勿重复提交'),{status:409});
    targets.forEach(id=>pending.add(id));
    try{return await action();}finally{targets.forEach(id=>pending.delete(id));}
  };
}
// `sudo -l command` lists permission; it NEVER executes command.
export const SHUTDOWN_CHECK = `if ! test -x ${SHUTDOWN_BIN}; then printf 'missing-script'; elif ! sudo -n -l ${SHUTDOWN_BIN} >/dev/null 2>&1; then printf 'sudo-denied'; else printf 'ready'; fi`;
export async function inspectShutdownReadiness(spark, {localExec=exec,remoteExec,container=process.env.HOST_ROOT_PATH==='/host/root'}={}) {
  let status='unavailable';
  try {
    const output=spark.isLocal
      ? (await localExec(container?'nsenter':'sh',container?['-t','1','-m','--','sh','-c',SHUTDOWN_CHECK]:['-c',SHUTDOWN_CHECK],{timeout:5000,maxBuffer:4096})).stdout
      : await remoteExec(spark,SHUTDOWN_CHECK,{timeoutMs:5000});
    const result=String(output).trim();
    if(['ready','missing-script','sudo-denied'].includes(result))status=result;
  } catch { /* Do not expose SSH credentials or raw stderr. */ }
  const messages={ready:'关机依赖检查通过；尚未执行关机', 'missing-script':'宿主机缺少可执行的 spark-shutdown 脚本，关机功能未就绪', 'sudo-denied':'未确认关机脚本的免密 sudo 权限，关机功能未就绪', unavailable:'无法确认宿主机关机依赖，请检查节点连接和权限'};
  return {ready:status==='ready',status,message:messages[status],checkedAt:Date.now()};
}

export function createReadinessInspector(options) {
  const cache=new Map();
  return async function inspect(spark,force=false) {
    const prior=cache.get(spark.id);
    if(!force&&prior&&Date.now()-prior.at<15000)return prior.result;
    const result=inspectShutdownReadiness(spark,options);
    cache.set(spark.id,{at:Date.now(),result});
    if(cache.size>200)cache.delete(cache.keys().next().value);
    return result;
  };
}
// Check every online dependency before starting, then stop on uncertainty.
export async function shutdownBatch(sparks, {isOnline,inspect,execute}) {
  const online=sparks.filter(isOnline);
  const checks=await Promise.all(online.map(async s=>({id:s.id,...await inspect(s,true)})));
  if(checks.some(c=>!c.ready))return {success:false,results:sparks.map(s=>{
    const c=checks.find(c=>c.id===s.id);
    return {id:s.id,ok:false,skipped:!c||c.ready,error:!c?'节点离线，已跳过':c.ready?'其他节点未就绪，本次整组未执行':c.message};
  })};
  let failed=false;
  const results=[];
  for(const s of sparks) {
    if(!online.includes(s)||failed){results.push({id:s.id,ok:false,skipped:true,error:failed?'先前节点执行失败或未确认，停止后续操作':'节点离线，已跳过'});continue;}
    try {results.push({id:s.id,ok:true,message:await execute(s)});}
    catch(e){failed=true;results.push({id:s.id,ok:false,error:e.message||'关机结果未确认'});}
  }
  return {success:online.length>0&&!failed,results};
}

// Fixed command only; a dropped connection is not proof of shutdown.
// No scripts or scheduled tasks are installed here.
export async function initiateSparkShutdown(spark, { localExec = exec, remoteExec, container = process.env.HOST_ROOT_PATH === '/host/root' } = {}) {
  if (spark.isLocal) {
    const command = container ? 'nsenter' : 'sudo';
    const args = container ? ['-t', '1', '-m', '--', 'sudo', '-n', SHUTDOWN_BIN] : ['-n', SHUTDOWN_BIN];
    try {
      await localExec(command, args, { timeout: 8000, maxBuffer: 4096 });
    } catch {
      throw new Error('关机命令失败或执行结果未确认；请检查宿主机 spark-shutdown 脚本和免密 sudo，勿将连接中断视为关机成功。');
    }
  } else {
    await remoteExec(spark, `test -x ${SHUTDOWN_BIN} && sudo -n ${SHUTDOWN_BIN}`, { timeoutMs: 8000 });
  }
  return '关机命令已执行，仍需确认节点离线';
}
