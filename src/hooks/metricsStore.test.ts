import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetStore,
  getMetricHistorySamples,
  ingestSnapshots,
} from "./metricsStore";
import { makeSpark } from "../testing/fixtures";

describe("metricsStore timestamp contract", () => {
  beforeEach(_resetStore);
  it('bounds real browser-only power history and never fills missing readings with zero',()=>{
    const s=makeSpark();
    for(let i=1;i<=100;i++) {s.metrics.gpu!.power.draw=i;ingestSnapshots([s],i*1000);}
    const samples=getMetricHistorySamples(s.id,'gpu.power');
    expect(samples).toHaveLength(60);expect(samples[0].value).toBe(41);
    s.metrics.gpu!.power.draw=NaN;ingestSnapshots([s],101000);
    expect(getMetricHistorySamples(s.id,'gpu.power')).toHaveLength(60);
    expect(getMetricHistorySamples(s.id,'gpu.power').at(-1)?.value).toBe(100);
  });
  it('separates model/backend history and does not append unavailable LLM zeros',()=>{
    const spark=makeSpark();spark.llmPorts=[8888];
    Object.assign(spark.metrics.llm[0],{backend:'sglang',modelId:'old',available:true,generationTps:100});
    ingestSnapshots([spark],1000);
    Object.assign(spark.metrics.llm[0],{backend:'tensorfold',modelId:'GLM',generationTps:20});
    ingestSnapshots([spark],2000);
    expect(getMetricHistorySamples(spark.id,'llm:8888.tps')).toEqual([{at:2000,value:20}]);
    spark.metrics.llm[0].available=false;ingestSnapshots([spark],3000);
    expect(getMetricHistorySamples(spark.id,'llm:8888.tps')).toHaveLength(1);
    expect(getMetricHistorySamples(spark.id,'gpu.usage')).toHaveLength(3);
  });

  it.each([1_000, 2_000, 5_000])("preserves a %sms source cadence", (interval) => {
    const spark = makeSpark();
    ingestSnapshots([spark], 10_000);
    spark.metrics.gpu!.usage = 50;
    ingestSnapshots([spark], 10_000 + interval);
    expect(getMetricHistorySamples(spark.id, "gpu.usage")).toEqual([
      { at: 10_000, value: 42 },
      { at: 10_000 + interval, value: 50 },
    ]);
  });

  it('an older frame cannot roll model identity back and erase current history',()=>{
    const spark=makeSpark();spark.llmPorts=[8888];
    Object.assign(spark.metrics.llm[0],{backend:'sglang',modelId:'current',available:true,generationTps:100});
    ingestSnapshots([spark],5000);
    Object.assign(spark.metrics.llm[0],{backend:'tensorfold',modelId:'old',generationTps:20});
    ingestSnapshots([spark],4000);
    expect(getMetricHistorySamples(spark.id,'llm:8888.tps')).toEqual([{at:5000,value:100}]);
    ingestSnapshots([],3000);
    expect(getMetricHistorySamples(spark.id,'llm:8888.tps')).toHaveLength(1);
  });

  it("replaces duplicate frames and retains real disconnect gaps", () => {
    const spark = makeSpark();
    ingestSnapshots([spark], 1_000);
    spark.metrics.gpu!.usage = 55;
    ingestSnapshots([spark], 1_000);
    spark.metrics.gpu!.usage = 60;
    ingestSnapshots([spark], 61_000);
    expect(getMetricHistorySamples(spark.id, "gpu.usage")).toEqual([
      { at: 1_000, value: 55 },
      { at: 61_000, value: 60 },
    ]);
  });

  it("ignores out-of-order frames instead of rewinding chart time", () => {
    const spark = makeSpark();
    ingestSnapshots([spark], 5_000);
    spark.metrics.gpu!.usage = 99;
    ingestSnapshots([spark], 4_000);
    expect(getMetricHistorySamples(spark.id, "gpu.usage")).toEqual([
      { at: 5_000, value: 42 },
    ]);
  });
});
