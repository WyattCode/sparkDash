import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sparkdash-registry-durability-"));
process.env.SPARKS_JSON_PATH = path.join(tmp, "sparks.json");
process.env.SPARKS_SECRETS_PATH = path.join(tmp, "sparks-secrets.json");
process.env.SECRETS_KEY_PATH = path.join(tmp, ".secrets-key");

const { SparkRegistry } = await import("../SparkRegistry.js");

function registry() {
  fs.writeFileSync(process.env.SPARKS_JSON_PATH, '{"sparks":[]}\n');
  fs.rmSync(process.env.SPARKS_SECRETS_PATH, { force: true });
  const r = new SparkRegistry();
  r.addSpark({ id: "existing", name: "Before", lanIp: "127.0.0.1" });
  r.setPassword("existing", "test-password");
  return r;
}

function failRegistryWrites(r) {
  r._save = () => {
    throw new Error("injected registry write failure");
  };
}

test("failed add leaves registry, secrets, and listeners unchanged", () => {
  const r = registry();
  const events = [];
  r.onChange((action) => events.push(action));
  failRegistryWrites(r);

  assert.throws(
    () => r.addSpark({ id: "new", name: "New", lanIp: "127.0.0.2", ssh: { password: "new-password" } }),
    /injected registry write failure/
  );
  assert.equal(r.getSpark("new"), null);
  assert.equal(r.hasPassword("new"), false);
  assert.deepEqual(events, []);
});

test("failed update preserves prior in-memory state and emits nothing", () => {
  const r = registry();
  const events = [];
  r.onChange((action) => events.push(action));
  failRegistryWrites(r);

  assert.throws(() => r.updateSpark("existing", { name: "After" }), /injected registry write failure/);
  assert.equal(r.getSpark("existing").name, "Before");
  assert.deepEqual(events, []);
});

test("failed remove preserves registry entry, secrets, and listeners", () => {
  const r = registry();
  const events = [];
  r.onChange((action) => events.push(action));
  failRegistryWrites(r);

  assert.throws(() => r.removeSpark("existing"), /injected registry write failure/);
  assert.equal(r.getSpark("existing").name, "Before");
  assert.equal(r.hasPassword("existing"), true);
  assert.deepEqual(events, []);
});

test("changing SSH destination drops old credentials but accepts a new password atomically", () => {
  const r = registry();
  r.setLlmApiKey('existing', 8888, 'old-api-key');
  r.updateSpark('existing', {ssh: {host: '127.0.0.2', password: 'new-password'}});
  assert.equal(r.getSpark('existing').ssh.password, 'new-password');
  assert.equal(r.getSpark('existing').llmApiKeys?.['8888'], undefined);
  const reloaded = new SparkRegistry();
  assert.equal(reloaded.getSpark('existing').ssh.password, 'new-password');
  assert.equal(reloaded.getSpark('existing').llmApiKeys?.['8888'], undefined);
});

test("failed host/secret save keeps the old destination and both old secrets on disk", () => {
  const r = registry();
  r.setLlmApiKey('existing', 8888, 'old-api-key');
  const original = r.getSpark('existing');
  const events = [];
  r.onChange((action) => events.push(action));
  r._saveSecrets = () => { throw Error('injected secret write failure'); };
  assert.throws(() => r.updateSpark('existing', {ssh: {host: '127.0.0.2', password:'new-password'}}), /injected secret/);
  assert.deepEqual(r.getSpark('existing'), original);
  assert.deepEqual(new SparkRegistry().getSpark('existing'), original);
  assert.deepEqual(events, []);
});

test("display edits retain credentials; SSH user and HTTP target changes clear only affected secrets", () => {
  const r = registry();
  r.setLlmApiKey('existing', 8888, 'old-api-key');
  r.updateSpark('existing', {name:'Renamed'});
  assert.equal(r.hasPassword('existing'), true);
  r.updateSpark('existing', {ssh:{user:'another'}});
  assert.equal(r.hasPassword('existing'), false);
  assert.equal(r.getSpark('existing').llmApiKeys?.['8888'], 'old-api-key');
  r.updateSpark('existing', {lanIp:'127.0.0.3'});
  assert.equal(r.getSpark('existing').llmApiKeys?.['8888'], undefined);
});
