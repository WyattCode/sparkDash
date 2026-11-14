import test from 'node:test';import assert from 'node:assert/strict';import{parseTensorfoldMetrics}from'../tensorfoldMetrics.js';
test('native ratios are bounded, aliases not summed, and zero remains a measured zero',()=>{
 let m=parseTensorfoldMetrics('tensorfold:prompt_tokens_total 1000\ntensorfold_health:cached_tokens_total 200\ntensorfold:kv_cache_usage_ratio{pool="0"} 0\ntensorfold:mtp_drafted_total 100\ntensorfold:mtp_accepted_total 60\ntensorfold:spec_decode_num_draft_tokens_total 100');assert.equal(m.cache,.2);assert.equal(m.kv,0);assert.equal(m.mtp,.6);assert.equal(m.poolUsage,null);
 m=parseTensorfoldMetrics('tensorfold:kv_cache_usage_ratio{pool="0"} 0.5\ntensorfold:kv_cache_usage_ratio{pool="1"} 0.5');assert.equal(m.kv,null);
});
test('native percentiles reject incomplete histograms and do not invent latency from no samples',()=>{
 const base='tensorfold:time_to_first_token_seconds_bucket{le="1"} 10\ntensorfold:time_to_first_token_seconds_bucket{le="+Inf"} 10\ntensorfold:time_to_first_token_seconds_count 10';
 assert.equal(parseTensorfoldMetrics(base).ttft,.95);assert.equal(parseTensorfoldMetrics(base.replace('le="+Inf"} 10','le="+Inf"} 9')).ttft,null);
 assert.equal(parseTensorfoldMetrics('').ttft,null);
});
