// TensorFold's native /metrics counters are lifetime values, not 30-minute rates.
export function parseTensorfoldMetrics(text) {
  const values = new Map();
  for (const line of text.split('\n')) {
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([^\s]+)(?:\s+\S+)?$/);
    if (!match) continue;
    const value = Number(match[3]);
    if (!Number.isFinite(value) || value < 0) continue;
    const key = match[1];
    const row = {labels: match[2] || '', value};
    values.set(key, [...(values.get(key) || []), row]);
  }
  const sum = name => {
    const rows = values.get(name);
    return rows?.length ? rows.reduce((n, row) => n + row.value, 0) : null;
  };
  function histogram(name) {
    const count = sum(name + '_count');
    const rows = values.get(name + '_bucket') || [];
    const byUpper = new Map();
    for (const row of rows) {
      const le = row.labels.match(/(?:\{|,)le="([^" ]+)"/);
      if (!le) continue;
      const upper = le[1] === '+Inf' ? Infinity : Number(le[1]);
      if (upper !== Infinity && (!Number.isFinite(upper) || upper < 0)) continue;
      byUpper.set(upper, (byUpper.get(upper) || 0) + row.value);
    }
    if (count == null || !byUpper.has(Infinity) || byUpper.get(Infinity) !== count) return {samples: null, p95: null};
    const buckets = [...byUpper].sort((a,b) => a[0]-b[0]);
    let lastUpper = 0, lastCount = 0;
    if (buckets.some(([,n],i) => n > count || (i > 0 && n < buckets[i-1][1]))) return {samples:null,p95:null};
    if (!count) return {samples:0,p95:null};
    for (const [upper,n] of buckets) {
      if (n >= count * .95) return {samples:count,p95:Number.isFinite(upper) ? lastUpper + (upper-lastUpper)*(count*.95-lastCount)/(n-lastCount) : null};
      lastUpper=upper; lastCount=n;
    }
    return {samples:count,p95:null};
  }
  const ttft=histogram('tensorfold:time_to_first_token_seconds');
  const e2e=histogram('tensorfold:request_latency_seconds');
  const prefill=histogram('tensorfold:request_prefill_seconds');
  const decode=histogram('tensorfold:request_decode_seconds');
  const tpot=histogram('tensorfold:request_time_per_output_token_seconds');
  const cached=sum('tensorfold_health:cached_tokens_total');
  const prompt=sum('tensorfold:prompt_tokens_total');
  const drafted=sum('tensorfold:mtp_drafted_total'), accepted=sum('tensorfold:mtp_accepted_total');
  const poolTotal=sum('tensorfold_health:pool_tokens'), poolFree=sum('tensorfold_health:pool_free_tokens');
  const validPool=poolTotal>0&&poolFree!=null&&poolFree<=poolTotal;
  return {
    completionTotal:sum('tensorfold:generation_tokens_total'), preemptions:sum('tensorfold:preemptions_total'),
    disconnected:sum('tensorfold:client_disconnections_total'), completed:e2e.samples,
    prefill:prefill.p95,prefillSamples:prefill.samples,decode:decode.p95,decodeSamples:decode.samples,
    tpot:tpot.p95,tpotSamples:tpot.samples,
    running:sum('tensorfold:requests_running'), waiting:sum('tensorfold:requests_waiting'),
    ttft:ttft.p95,ttftSamples:ttft.samples,e2e:e2e.p95,e2eSamples:e2e.samples,
    cache:cached!=null&&prompt>0&&cached<=prompt?cached/prompt:null,
    cacheHits:cached,cacheQueries:prompt,
    // Per-pool ratios cannot be summed into a global utilization percentage.
    kv:values.get('tensorfold:kv_cache_usage_ratio')?.length===1 && values.get('tensorfold:kv_cache_usage_ratio')[0].value<=1 ? values.get('tensorfold:kv_cache_usage_ratio')[0].value : null,
    mtp:drafted>0&&accepted!=null&&accepted<=drafted?accepted/drafted:null,
    poolUsage:validPool?(poolTotal-poolFree)/poolTotal:null,
    poolTotal:validPool?poolTotal:null,poolUsed:validPool?poolTotal-poolFree:null,
    httpTotal:null,httpOk:null,itl:null,itlSamples:null,queue:null,queueSamples:null,
  };
}
