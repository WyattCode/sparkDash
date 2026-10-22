// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mia's AI Lab. From MiaAI-Lab/sparkDash f8b1a48; see NOTICE.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  ROCE_FAST_SCRIPT,
  RoceSampler,
  parseMlnxQos,
  parseRoceFast,
  parseRoceSlow,
  roceSlowScript,
} from "../roce.js";
import { FAST, SLOW } from "./roce.fixtures.js";

test("parseRoceFast reads link state, rate, counters and netdev statistics", () => {
  const { devices, netdevs } = parseRoceFast(FAST);
  assert.equal(devices.length, 2);
  const d = devices.find((x) => x.name === "rocep1s0f0");
  assert.equal(d.state, "ACTIVE");
  assert.equal(d.physState, "LinkUp");
  assert.equal(d.rateGbps, 200);
  assert.equal(d.linkLayer, "Ethernet");
  assert.equal(d.netdev, "enp1s0f0np0");
  assert.equal(d.counters.out_of_buffer, 0);
  assert.ok("np_cnp_sent" in d.counters);
  const n = netdevs.get("enp1s0f0np0");
  assert.equal(n.mtu, 9000);
  assert.equal(n.speedMbps, 200000);
  assert.equal(n.operstate, "up");
  assert.ok(n.rxBytes > 0 && n.txBytes > 0);
});

test("parseRoceFast tolerates garbage and empty output", () => {
  assert.deepEqual(parseRoceFast("").devices, []);
  assert.deepEqual(parseRoceFast("nonsense\nDEV|only|two").devices, []);
});

test("parseMlnxQos reads trust, PFC priorities, cable length and the DSCP map", () => {
  const pcp = parseMlnxQos(
    "DCBX mode: OS controlled\nPriority trust state: pcp\nCable len: 7\nPFC configuration:\n\tpriority    0   1   2   3   4   5   6   7\n\tenabled     0   0   0   0   0   0   0   0   \n\tbuffer      1   1   1   1   1   1   1   1   \n"
  );
  assert.deepEqual(pcp, { trust: "pcp", pfcPriorities: [], cableLen: 7, dscpMap: null });
  const dscp = parseMlnxQos(
    "Priority trust state: dscp\nPFC configuration:\n\tpriority    0   1   2   3   4   5   6   7\n\tenabled     0   0   0   1   0   0   0   0   \ndscp2prio mapping:\n\tprio:0 dscp:07,06,05,04,03,02,01,00,\n\tprio:3 dscp:31,30,29,28,27,26,25,24,\n"
  );
  assert.equal(dscp.trust, "dscp");
  assert.deepEqual(dscp.pfcPriorities, [3]);
  assert.deepEqual(dscp.dscpMap["3"], [31, 30, 29, 28, 27, 26, 25, 24]);
  assert.deepEqual(parseMlnxQos("").pfcPriorities, null);
});

test("parseRoceSlow reads ethtool counters, pause settings and mlnx_qos per interface", () => {
  const slow = parseRoceSlow(SLOW);
  const a = slow.get("enp1s0f0np0");
  assert.equal(a.eth.rx_discards_phy, 0);
  assert.equal(a.eth.rx_pause_ctrl_phy, 0);
  assert.deepEqual(a.flowControl, { rx: true, tx: true });
  assert.equal(a.qos.trust, "pcp");
  assert.deepEqual(a.qos.pfcPriorities, []);
  assert.ok(slow.has("enp1s0f1np1"));
});

test("the slow script only embeds valid interface names", () => {
  assert.equal(roceSlowScript(["bad name; rm -rf /", "$(x)"]), null);
  const script = roceSlowScript(["enp1s0f0np0", "x;y", "enp1s0f0np0"]);
  assert.match(script, /for n in enp1s0f0np0; do/);
  assert.doesNotMatch(script, /rm -rf/);
});

test("the fast script is plain POSIX sh and only reads", () => {
  assert.doesNotMatch(ROCE_FAST_SCRIPT, /\b(rm|sudo|tee|>|mv|chmod)\b\s/);
  assert.match(ROCE_FAST_SCRIPT, /\/sys\/class\/infiniband/);
});

function fakeRun(state) {
  return async (script) => (script.includes("mlnx_qos") ? state.slow : state.fast);
}

test("RoceSampler computes rates and counter deltas from consecutive samples", async () => {
  const state = { fast: FAST, slow: SLOW };
  let t = 1_000_000;
  const sampler = new RoceSampler({ run: fakeRun(state), now: () => t });
  const first = await sampler.sample();
  assert.equal(first.devices.length, 2);
  assert.equal(first.devices[0].rxBps, null); // no baseline yet
  assert.equal(first.devices[0].qos.trust, "pcp");

  t += 5_000;
  // 5 s later: +5,000,000 rx bytes and out_of_buffer +4 on the first device.
  state.fast = FAST
    .replace(/(NET\|enp1s0f0np0\|up\|9000\|200000\|)(\d+)/, (_, a, rx) => `${a}${Number(rx) + 5_000_000}`)
    .replace(/(CNT\|rocep1s0f0\|out_of_buffer\|)0/, "$14");
  const second = await sampler.sample();
  const d = second.devices.find((x) => x.name === "rocep1s0f0");
  assert.equal(Math.round(d.rxBps), 1_000_000);
  assert.equal(d.deltas.out_of_buffer, 4);
  assert.deepEqual(d.loss.rising, ["out_of_buffer"]);
  assert.equal(d.loss.streak, 1);
});

test("RoceSampler throttles to one fast sample per ~4.5 s", async () => {
  let runs = 0;
  let t = 0;
  const sampler = new RoceSampler({
    run: async (s) => {
      runs += 1;
      return s.includes("mlnx_qos") ? SLOW : FAST;
    },
    now: () => t,
  });
  await sampler.sample();
  const after = runs;
  t += 2_000;
  await sampler.sample();
  assert.equal(runs, after);
});

test('reopening after a long pause rebases rates instead of displaying the closed-period average',async()=>{
  let now=1000000;const state={fast:FAST,slow:SLOW};
  const sampler=new RoceSampler({run:fakeRun(state),now:()=>now});
  await sampler.sample();now+=120000;
  state.fast=FAST.replace(/(NET\|enp1s0f0np0\|up\|9000\|200000\|)(\d+)/,(_,prefix,rx)=>prefix+(Number(rx)+12000000));
  const reopened=await sampler.sample();
  const d=reopened.devices.find(d=>d.netdev==='enp1s0f0np0');
  assert.equal(d.rxBps,null);assert.deepEqual(d.deltas,{});
  now+=10000;state.fast=state.fast.replace(/(NET\|enp1s0f0np0\|up\|9000\|200000\|)(\d+)/,(_,prefix,rx)=>prefix+(Number(rx)+1000000));
  assert.equal((await sampler.sample()).devices.find(d=>d.netdev==='enp1s0f0np0').rxBps,100000);
});

test('a resetting network counter is unavailable for that interval, not measured zero traffic',async()=>{
  let now=1000000;const state={fast:FAST,slow:SLOW};
  const sampler=new RoceSampler({run:fakeRun(state),now:()=>now});await sampler.sample();
  now+=10000;state.fast=FAST.replace(/(NET\|enp1s0f0np0\|up\|9000\|200000\|)(\d+)/,'$10');
  assert.equal((await sampler.sample()).devices.find(d=>d.netdev==='enp1s0f0np0').rxBps,null);
});

test("a unit without RDMA devices is skipped and re-checked only every 10 minutes", async () => {
  let runs = 0;
  let t = 0;
  const sampler = new RoceSampler({ run: async () => (runs++, ""), now: () => t });
  assert.equal(await sampler.sample(), null);
  t += 60_000;
  assert.equal(await sampler.sample(), null);
  assert.equal(runs, 1);
  t += 10 * 60_000;
  await sampler.sample();
  assert.equal(runs, 2);
});

test("the loss streak grows while counters keep rising and resets when they stop", async () => {
  const state = { fast: FAST, slow: SLOW };
  let t = 0;
  const sampler = new RoceSampler({ run: fakeRun(state), now: () => t });
  await sampler.sample();
  let value = 0;
  const streaks = [];
  for (let i = 0; i < 4; i++) {
    t += 5_000;
    value += 10;
    state.fast = FAST.replace(/(CNT\|rocep1s0f0\|packet_seq_err\|)0/, `$1${value}`);
    const r = await sampler.sample();
    streaks.push(r.devices.find((x) => x.name === "rocep1s0f0").loss.streak);
  }
  assert.deepEqual(streaks, [1, 2, 3, 4]);
  t += 5_000; // counter unchanged
  const r = await sampler.sample();
  assert.equal(r.devices.find((x) => x.name === "rocep1s0f0").loss.streak, 0);
});


test("a discard change advances the slow streak but not the fast RDMA streak", async () => {
  const state = { fast: FAST, slow: SLOW };
  let t = 1_000_000;
  const sampler = new RoceSampler({ run: fakeRun(state), now: () => t });
  await sampler.sample();
  t += 30_000;
  // 30 s later rx_discards_phy rose by 1, once.
  state.slow = SLOW.replace(/(ETH\|enp1s0f0np0\n(?:.*\n)*?\s+rx_discards_phy:\s+)0/, "$11");
  const withBlip = await sampler.sample();
  const dev = withBlip.devices.find((x) => x.netdev === "enp1s0f0np0");
  assert.equal(dev.loss.ethStreak, 1);
  const streaks = [];
  for (let i = 0; i < 5; i++) {
    t += 5_000; // fast samples between slow ones must not inflate anything
    const r = await sampler.sample();
    streaks.push(r.devices.find((x) => x.netdev === "enp1s0f0np0").loss.streak);
  }
  assert.deepEqual(streaks, [0, 0, 0, 0, 0]);
});

test("port discards rising on two slow samples retain the slow streak", async () => {
  const state = { fast: FAST, slow: SLOW };
  let t = 1_000_000;
  const sampler = new RoceSampler({ run: fakeRun(state), now: () => t });
  await sampler.sample();
  let last;
  for (let i = 1; i <= 2; i++) {
    t += 30_000;
    state.slow = SLOW.replace(/(ETH\|enp1s0f0np0\n(?:.*\n)*?\s+rx_discards_phy:\s+)0/, `$1${i * 10}`);
    last = await sampler.sample();
  }
  assert.equal(last.devices.find((x) => x.netdev === "enp1s0f0np0").loss.ethStreak, 2);
});

test("devices that vanish or a failed read keep the last sample for a few reads, then drop it", async () => {
  const state = { fast: FAST, slow: SLOW, fail: false };
  let t = 1_000_000;
  const run = async (script) => {
    if (state.fail) throw new Error("ssh timed out");
    return script.includes("mlnx_qos") ? state.slow : state.fast;
  };
  const sampler = new RoceSampler({ run, now: () => t });
  const good = await sampler.sample();
  assert.equal(good.devices.length, 2);

  // empty output (driver reload): the last good sample stands, and no 10-minute blackout
  state.fast = "";
  t += 5_000;
  assert.equal((await sampler.sample()).devices.length, 2);
  t += 20_000;
  assert.equal((await sampler.sample()).devices.length, 2);
  state.fast = FAST;
  t += 20_000;
  assert.equal((await sampler.sample()).devices.length, 2); // recovered at the normal pace

  // read failures: kept at first, then the error surfaces
  state.fail = true;
  const seen = [];
  for (let i = 0; i < 6; i++) {
    t += 20_000;
    try {
      seen.push((await sampler.sample())?.devices.length ?? null);
    } catch {
      seen.push("error");
    }
  }
  assert.deepEqual(seen.slice(0, 3), [2, 2, 2]);
  assert.ok(seen.includes("error"));
});

test("overlapping sample() calls share one read", async () => {
  let runs = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const sampler = new RoceSampler({
    run: async (s) => {
      runs += 1;
      await gate;
      return s.includes("mlnx_qos") ? SLOW : FAST;
    },
    now: () => 100_000, // past the 30 s slow interval, so one fast and one slow read happen
  });
  const a = sampler.sample();
  const b = sampler.sample();
  release();
  await Promise.all([a, b]);
  assert.equal(runs, 2); // one fast + one slow, not four
});

test("devices come back in a stable order whatever the sysfs glob order", async () => {
  const reversed = FAST.split("\n").reverse().join("\n");
  const a = await new RoceSampler({ run: fakeRun({ fast: FAST, slow: SLOW }), now: () => 0 }).sample();
  const b = await new RoceSampler({ run: fakeRun({ fast: reversed, slow: SLOW }), now: () => 0 }).sample();
  assert.deepEqual(a.devices.map((d) => d.netdev), b.devices.map((d) => d.netdev));
});
