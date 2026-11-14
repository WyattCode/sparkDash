import { test } from "node:test";
import assert from "node:assert/strict";
import { allowOpenRemote, authenticate, authorizeUpgrade, configuredToken, extractBearer, requireRemoteAuth } from "../../auth.js";
import { createRateLimiter, validateSparkTarget } from "../../validate.js";

test("loopback bind does not require a remote token", () => {
  assert.equal(requireRemoteAuth("127.0.0.1"), false);
  assert.equal(requireRemoteAuth("0.0.0.0"), true);
});

test("open remote bind is on by default and off when SPARKDASH_ALLOW_OPEN_REMOTE=0", () => {
  const previous = process.env.SPARKDASH_ALLOW_OPEN_REMOTE;
  try {
    delete process.env.SPARKDASH_ALLOW_OPEN_REMOTE;
    assert.equal(allowOpenRemote(), true);
    process.env.SPARKDASH_ALLOW_OPEN_REMOTE = "1";
    assert.equal(allowOpenRemote(), true);
    process.env.SPARKDASH_ALLOW_OPEN_REMOTE = "0";
    assert.equal(allowOpenRemote(), false);
  } finally {
    if (previous == null) delete process.env.SPARKDASH_ALLOW_OPEN_REMOTE;
    else process.env.SPARKDASH_ALLOW_OPEN_REMOTE = previous;
  }
});

test("bearer authentication rejects a wrong token", () => {
  const previous = process.env.SPARKDASH_TOKEN;
  process.env.SPARKDASH_TOKEN = "secret-token";
  try {
    assert.equal(configuredToken(), "secret-token");
    const denied = authenticate({ headers: { authorization: "Bearer no" }, query: {} });
    assert.equal(denied.ok, false);
    const allowed = authenticate({ headers: { authorization: "Bearer secret-token" }, query: {} });
    assert.equal(allowed.ok, true);
  } finally {
    if (previous == null) delete process.env.SPARKDASH_TOKEN;
    else process.env.SPARKDASH_TOKEN = previous;
  }
});

test("local units may omit LAN IP while remote units still require a host", () => {
  assert.equal(validateSparkTarget({ isLocal: true }), null);
  assert.match(validateSparkTarget({ isLocal: false }), /lanIp or ssh.host/);
  assert.equal(validateSparkTarget({ lanIp: "192.168.1.20" }), null);
  assert.match(validateSparkTarget({isLocal:true,ssh:{user:'bad;user'}}), /Invalid SSH user/);
});

test('raw WebSocket upgrade reads URL token and respects Authorization precedence', () => {
  const previous = process.env.SPARKDASH_TOKEN;
  process.env.SPARKDASH_TOKEN = 'test+token';
  try {
    assert.equal(authorizeUpgrade({headers:{},url:'/ws?token=test%2Btoken'}), true);
    assert.equal(authorizeUpgrade({headers:{},url:'/ws?token=wrong'}), false);
    assert.equal(authorizeUpgrade({headers:{authorization:'Bearer wrong'},url:'/ws?token=test%2Btoken'}), false);
    assert.equal(extractBearer({headers:{},url:'http://['}), '');
  } finally {
    if (previous === undefined) delete process.env.SPARKDASH_TOKEN;
    else process.env.SPARKDASH_TOKEN = previous;
  }
});

test("rate limiter expires stale keys instead of growing forever", () => {
  const allow = createRateLimiter(2, 20);
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), false);
  const started = Date.now();
  while (Date.now() - started < 30) { /* wait out the window */ }
  assert.equal(allow("a"), true);
});
