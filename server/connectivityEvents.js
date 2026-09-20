import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// No raw commands, errors, credentials, URLs or user-agent strings are stored.
export function classifyProbeError(error) {
  const s = String(error?.message || '');
  const d = error?.probeDiagnostic;
  return d || {category: /banner exchange/i.test(s) ? 'ssh_banner_timeout'
    : /timed? out|timeout/i.test(s) ? 'timeout'
    : /Permission denied|authentication/i.test(s) ? 'authentication'
    : /Host key verification|REMOTE HOST IDENTIFICATION/i.test(s) ? 'host_key'
    : /refused/i.test(s) ? 'connection_refused'
    : /reset|broken pipe/i.test(s) ? 'connection_reset'
    : /unreachable|No route/i.test(s) ? 'unreachable' : 'probe_failed'};
}

export class ConnectivityJournal {
  constructor(file, {maxBytes = 1024 * 1024, bootId = crypto.randomUUID()} = {}) {
    this.file = file; this.maxBytes = maxBytes; this.bootId = bootId;
    this.events = []; this.storageError = false; this.damagedLines = 0;
    for (const suffix of ['.2', '.1', '']) {
      try {
        for (const line of fs.readFileSync(file + suffix, 'utf8').split('\n')) {
          if (!line) continue;
          try { this.events.push(JSON.parse(line)); } catch { this.damagedLines++; }
        }
      } catch (e) { if (e.code !== 'ENOENT') this.storageError = true; }
    }
    this.events = this.events.slice(-1000);
  }
  write(fields) {
    const row = {...fields, at: Date.now(), bootId: this.bootId, eventId: crypto.randomUUID()};
    this.events.push(row); this.events = this.events.slice(-1000);
    try {
      fs.mkdirSync(path.dirname(this.file), {recursive: true, mode: 0o700});
      let line = JSON.stringify(row) + '\n';
      const size = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
      if (size) {
        const fd=fs.openSync(this.file,'r');
        try { const tail=Buffer.alloc(1);fs.readSync(fd,tail,0,1,size-1);if(tail[0]!==10)line='\n'+line; }
        finally { fs.closeSync(fd); }
      }
      if (size + Buffer.byteLength(line) > this.maxBytes) {
        if (fs.existsSync(this.file + '.2')) fs.unlinkSync(this.file + '.2');
        if (fs.existsSync(this.file + '.1')) fs.renameSync(this.file + '.1', this.file + '.2');
        if (fs.existsSync(this.file)) fs.renameSync(this.file, this.file + '.1');
      }
      fs.appendFileSync(this.file, line, {mode: 0o600});
      this.storageError = false;
    } catch { this.storageError = true; }
    return row;
  }
  snapshot() {
    return {bootId: this.bootId, storageError: this.storageError, damagedLines: this.damagedLines,
      retention: {files: 3, maxBytesPerFile: this.maxBytes, apiEvents: 1000}, events: this.events};
  }
}

const CLIENT_KINDS = new Set(['ws_open', 'ws_close', 'ws_error', 'snapshot_received', 'snapshot_applied', 'invalid_snapshot', 'pagehide', 'pageshow']);
export function cleanClientEvent(body, nodeIds) {
  if (!body || !CLIENT_KINDS.has(body.kind) || typeof body.clientId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(body.clientId)) return null;
  const row = {source: 'browser', kind: body.kind, clientId: body.clientId,
    browser: ['firefox','chromium','other'].includes(body.browser) ? body.browser : 'other',
    visibility: body.visibility === 'hidden' ? 'hidden' : 'visible', leavingPage: body.leavingPage === true};
  for (const k of ['clientAt','generatedAt']) if (Number.isFinite(body[k]) && body[k] >= 0) row[k] = body[k];
  if (typeof body.serverBootId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(body.serverBootId)) row.serverBootId = body.serverBootId;
  if (Number.isInteger(body.closeCode) && body.closeCode >= 0 && body.closeCode <= 4999) row.closeCode = body.closeCode;
  if (body.states !== undefined) {
    if (!Array.isArray(body.states) || body.states.length > nodeIds.length) return null;
    const seen = new Set(); row.states = [];
    for (const s of body.states) {
      if (!s || !nodeIds.includes(s.id) || seen.has(s.id) || typeof s.online !== 'boolean') return null;
      seen.add(s.id); row.states.push({id:s.id, online:s.online});
    }
  }
  return row;
}

export function createConnectivityEvents({file, nodeIds, snapshots, fetchImpl = fetch}) {
  const journal = new ConnectivityJournal(file);
  const url = process.env.SPARKDASH_PROMETHEUS_URL || 'http://127.0.0.1:9090';
  let pending = null, cached = null;
  async function independent() {
    if (cached && Date.now() - cached.checkedAt < 2000) return cached;
    if (pending) return pending;
    pending = (async () => {
      try {
        const queries = ['up{job=~"node|dcgm"}', 'time()-timestamp(DCGM_FI_DEV_GPU_TEMP)'];
        const results = await Promise.all(queries.map(async query => {
          const res = await fetchImpl(`${url}/api/v1/query?${new URLSearchParams({query})}`, {signal:AbortSignal.timeout(3000)});
          if (!res.ok) throw Error('http');
          const d = await res.json(); if (d.status !== 'success' || !Array.isArray(d.data?.result)) throw Error('format');
          return d.data.result.filter(r => nodeIds().includes(r.metric?.node)).map(r => ({node:r.metric.node, job:r.metric.job, value:Number(r.value[1]), sampleAt:Number(r.value[0])*1000}));
        }));
        cached = {checkedAt:Date.now(), available:true, up:results[0], gpuAgeSeconds:results[1]};
      } catch { cached = {checkedAt:Date.now(), available:false}; }
      return cached;
    })().finally(() => {pending = null;});
    return pending;
  }
  function record(fields) {
    const event = journal.write(fields);
    if (fields.source === 'monitor' && ['probe_failure','probe_recovered','monitor_start'].includes(fields.kind)) {
      void independent().then(data => journal.write({source:'prometheus', kind:'correlation', causeEventId:event.eventId, node:fields.node, ...data}));
    }
  }
  const limits = new Map();
  function register(app) {
    app.get('/api/connectivity/events', (_req,res) => res.json({...journal.snapshot(), current:snapshots().map(s => ({id:s.id, online:s.online, connectivity:s.connectivity, telemetry:s.telemetry}))}));
    app.post('/api/connectivity/client-events', (req,res) => {
      const key = req.ip || 'unknown', now = Date.now();
      for (const [k,v] of limits) if (now-v.start>60000) limits.delete(k);
      const bucket = limits.get(key) || {start:now,count:0};
      if (limits.size >= 256 && !limits.has(key)) return res.sendStatus(429);
      if (++bucket.count > 120) return res.sendStatus(429);
      limits.set(key,bucket);
      const event = cleanClientEvent(req.body,nodeIds());
      if (!event) return res.status(400).json({error:'Invalid connectivity event'});
      journal.write({...event, current:snapshots().map(s => ({id:s.id,online:s.online}))});
      res.status(202).json({ok:true,bootId:journal.bootId});
    });
  }
  return {journal,record,register};
}
