import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWrite } from "../../util/atomicWrite.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sparkdash-settings-test-"));
process.env.SETTINGS_JSON_PATH = path.join(dir, "settings.json");
const { loadSettings, getSettings, updateSettings } = await import("../../settings.js");
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("settings persist before memory changes; failed writes preserve both", t => {
  const initial = loadSettings();
  const disk = fs.readFileSync(process.env.SETTINGS_JSON_PATH, "utf8");
  t.mock.method(fs, "renameSync", () => { throw new Error("injected rename failure"); });
  assert.throws(() => updateSettings({ defaultLlmPort: 9000 }), /injected rename failure/);
  assert.deepEqual(getSettings(), initial);
  assert.equal(fs.readFileSync(process.env.SETTINGS_JSON_PATH, "utf8"), disk);
  assert.deepEqual(fs.readdirSync(dir), ["settings.json"]);
});

test("settings bound timers, validate integer ports, booleans and allowed keys", () => {
  const result = updateSettings({ pollIntervalMs: 1e30, defaultLlmPort: 1234.5,
    hideWorkers: "false", benchShareImage: "false", extra: "discard" });
  assert.equal(result.pollIntervalMs, 2147483647);
  assert.equal(result.defaultLlmPort, 8888);
  assert.equal(result.hideWorkers, false);
  assert.equal(result.benchShareImage, true);
  assert.equal("extra" in result, false);
  assert.equal(updateSettings({ pollIntervalMs: NaN }).pollIntervalMs, 2000);
  assert.equal(updateSettings({ pollIntervalMs: -1 }).pollIntervalMs, 1000);
  assert.equal(updateSettings({ defaultLlmPort: Infinity }).defaultLlmPort, 8888);
  assert.throws(() => updateSettings([]), /对象/);
  assert.throws(() => updateSettings(null), /对象/);
});

test("atomic replacement preserves destination content and permissions on failure", t => {
  const target = path.join(dir, "secret.json");
  fs.writeFileSync(target, "original", { mode: 0o600 });
  t.mock.method(fs, "renameSync", () => { throw new Error("denied"); });
  assert.throws(() => atomicWrite(target, "replacement"), /denied/);
  assert.equal(fs.readFileSync(target, "utf8"), "original");
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  assert.equal(fs.readdirSync(dir).some(name => name.endsWith(".tmp")), false);
});

test("partial temporary writes are cleaned up without touching the destination", t => {
  const target = path.join(dir, "partial.json");
  fs.writeFileSync(target, "original");
  const write = fs.writeFileSync.bind(fs);
  t.mock.method(fs, "writeFileSync", (file, ...args) => {
    if (typeof file === "number") { write(file, "partial"); throw new Error("disk full"); }
    return write(file, ...args);
  });
  assert.throws(() => atomicWrite(target, "replacement"), /disk full/);
  assert.equal(fs.readFileSync(target, "utf8"), "original");
  assert.equal(fs.readdirSync(dir).some(name => name.endsWith(".tmp")), false);
});
