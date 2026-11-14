import test from 'node:test';
import assert from 'node:assert/strict';
import { SparkMonitor } from '../SparkMonitor.js';

const config = {id:'backoff-test',isLocal:false,lanIp:'127.0.0.1',llmMonitoring:false};
function monitor() {
  const m = new SparkMonitor(config);
  m._running = true;
  return m;
}

test('offline remote collectors pause, local collectors remain independent', async () => {
  const m = monitor();
  let calls = 0;
  m.collector.collectRam = async () => { calls++; return {}; };
  await m._pollDomain('ram');
  assert.equal(calls, 0);
  m.online = true;
  await m._pollDomain('ram');
  assert.equal(calls, 1);
  m.online = false;
  m.spark = {...config,isLocal:true};
  await m._pollDomain('ram');
  assert.equal(calls, 2);
});

test('network backoff widens, gates probes, and resets on recovery', async (t) => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const m = monitor();
  let calls = 0;
  m._readUptime = async () => { calls++; throw Error('connection timed out'); };
  for (const delay of [5000,15000,30000,60000,60000]) {
    const before = calls;
    await m._checkOnline();
    assert.equal(calls, before + 1);
    assert.equal(m._nextLivenessAt, now + delay);
    await m._checkOnline();
    assert.equal(calls, before + 1);
    now += delay;
  }
  m._readUptime = async () => 42;
  await m._checkOnline();
  assert.equal(m.online, true);
  assert.equal(m._nextLivenessAt, 0);
  assert.equal(m._livenessFailures, 0);
  assert.equal(m.snapshot().connectivity.lastError, null);
});

test('authentication failures pause collectors during grace; editing resets slow retries', async (t) => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const m = monitor();
  m.online = true;
  m.lastOnlineOk = now;
  m._readUptime = async () => { throw Error('Permission denied (publickey)'); };
  let calls = 0;
  m.collector.collectRam = async () => { calls++; return {}; };
  await m._checkOnline();
  assert.equal(m.online, true);
  await m._pollDomain('ram');
  assert.equal(calls, 0);
  for (let i=1; i<5; i++) { now=m._nextLivenessAt; await m._checkOnline(); }
  assert.equal(m._nextLivenessAt-now, 900000);
  m.updateConfig(config);
  assert.equal(m._nextLivenessAt, 0);
  assert.equal(m._livenessFailures, 0);
  m._readUptime = async () => 42;
  await m._checkOnline();
  await m._pollDomain('ram');
  assert.equal(calls, 1);
});
