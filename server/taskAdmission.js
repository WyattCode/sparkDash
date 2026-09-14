/** Call immediately before synchronous start(), after all async target checks. */
export function assertBenchmarkAdmission(sparkId, kind, {decode, prefill, showcase, maxActive = 2}) {
  const conflicts = [
    [showcase.getActive(sparkId), 'A prompt showcase is already running for this Spark'],
    [decode.getActive(sparkId), 'A decode benchmark is already running for this Spark'],
    [prefill.getActive(sparkId), 'A prefill benchmark is already running for this Spark'],
  ];
  for (const [active, message] of conflicts) {
    if (active) throw Object.assign(new Error(message), {status:409});
  }
  if (decode.activeCount() + prefill.activeCount() >= maxActive) {
    throw Object.assign(new Error('Global active benchmark cap reached; wait for a job to finish'), {status:429});
  }
}
