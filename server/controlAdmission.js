import fs from 'node:fs';
import crypto from 'node:crypto';

// A synchronous reservation covers both panels, including async admission checks.
// Persist reservations across panel restarts. Never time out a live deployment.
export function registerControlAdmission(app, { file, readSecret, activeJobs }) {
  let pending = 0;
  const read = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  };
  const authorized = req => {
    try {
      const a = Buffer.from(req.get('X-DGX-Control') || '');
      const b = Buffer.from(readSecret().trim());
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { return false; }
  };
  app.get('/api/control-operation', (req, res) => {
    try {
      const lease = read();
      res.json({ busy: !!lease || pending > 0 || activeJobs(), owner: lease?.owner || null, since: lease?.since || null });
    } catch { res.status(503).json({error:'操作锁状态未知，请检查控制中心'}); }
  });
  app.post('/api/control-operation', (req, res) => {
    if (!authorized(req)) return res.status(403).json({error:'控制凭据无效'});
    const { action, token, owner } = req.body || {};
    if (!/^[a-f0-9]{32}$/.test(token || '')) return res.status(400).json({error:'操作标识无效'});
    try {
      const lease = read();
      if (action === 'release') {
        if (lease && lease.token !== token) return res.status(409).json({error:'操作锁所有者不匹配'});
        if (lease) fs.unlinkSync(file);
        return res.json({ok:true});
      }
      if (action !== 'reserve') return res.status(400).json({error:'操作无效'});
      if (lease || pending || activeJobs()) return res.status(409).json({error:'另一项部署、测试或实时生成正在进行'});
      fs.writeFileSync(file, JSON.stringify({ token, owner:String(owner || '控制中心').slice(0,80), since:Date.now() }), {flag:'wx',mode:0o600});
      res.json({ok:true});
    } catch { res.status(503).json({error:'操作锁不可用，请检查控制中心'}); }
  });
  app.use((req, res, next) => {
    if (req.method !== 'POST' || !/^\/api\/sparks\/[^/]+\/llm\/(showcase|bench|prefill-bench)$/.test(req.path)) return next();
    try {
      const lease = read();
      const own = lease && authorized(req) && req.get('X-DGX-Operation') === lease.token && req.path.endsWith('/showcase');
      if ((lease && !own) || pending || activeJobs()) return res.status(409).json({error:'另一项部署、测试或实时生成正在进行，请完成后再试'});
      pending++;
      let finished = false;
      const done = () => { if (!finished) { finished = true; pending--; } };
      res.once('finish', done); // An aborted admission stays blocked until supervised panel restart.
      next();
    } catch { res.status(503).json({error:'操作状态未知，已暂停新任务'}); }
  });
}
