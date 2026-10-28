const DEFAULT_P99_LIMIT_US = 1050;
const DEFAULT_P999_LIMIT_US = 1200;
const DEFAULT_MINIMUM_DURATION_SEC = 1800;
const DEFAULT_CYCLE_US = 1000;

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

export function assessBenchmark(benchmark, options = {}) {
  const p99LimitUs = options.p99LimitUs ?? DEFAULT_P99_LIMIT_US;
  const p999LimitUs = options.p999LimitUs ?? DEFAULT_P999_LIMIT_US;
  const minimumDurationSec =
    options.minimumDurationSec ?? DEFAULT_MINIMUM_DURATION_SEC;
  const cycleUs = options.cycleUs ?? DEFAULT_CYCLE_US;

  if (!benchmark || typeof benchmark !== "object") {
    return {
      status: "failed",
      result: "not-accepted",
      exitCode: 1,
      completed: false,
      simulated: false,
      p99Us: null,
      p999Us: null,
      wkcErrors: null,
      lostFrames: null,
      samples: 0,
      expectedSamples: 0,
      sampleCoverage: 0,
      p99ok: false,
      p999ok: false,
      wkcOk: false,
      enoughSamples: false,
      thresholdsMet: false,
      durationQualified: false,
      accepted: false,
      p99LimitUs,
      p999LimitUs,
      minimumDurationSec
    };
  }

  const completed = benchmark.status === "completed";
  const simulated = benchmark.simulated === true;
  const p99Us = finiteNumber(benchmark.cycleTime?.p99Us);
  const p999Us = finiteNumber(benchmark.cycleTime?.p999Us);
  const wkcErrors = finiteNumber(benchmark.wkcErrors);
  const lostFrames = finiteNumber(benchmark.lostFrames);
  const samples = Math.max(0, finiteNumber(benchmark.samples) ?? 0);
  const requestedDurationSec = Math.max(
    0,
    finiteNumber(benchmark.durationSec) ?? 0
  );
  const elapsedSec = Math.max(0, finiteNumber(benchmark.elapsedSec) ?? 0);
  const expectedSamples =
    cycleUs > 0 ? Math.floor((elapsedSec * 1_000_000) / cycleUs) : 0;
  const sampleCoverage =
    expectedSamples > 0 ? samples / expectedSamples : 0;

  const p99ok = p99Us !== null && p99Us <= p99LimitUs;
  const p999ok = p999Us !== null && p999Us <= p999LimitUs;
  const wkcOk = wkcErrors === 0;
  const enoughSamples =
    samples > 0 &&
    expectedSamples > 0 &&
    sampleCoverage >= 0.9;
  const thresholdsMet = p99ok && p999ok && wkcOk;
  const durationQualified =
    completed &&
    requestedDurationSec >= minimumDurationSec &&
    elapsedSec >= minimumDurationSec * 0.999;
  const accepted =
    !simulated &&
    completed &&
    thresholdsMet &&
    enoughSamples &&
    durationQualified;

  let status = "failed";
  let result = "not-accepted";
  if (simulated) {
    result = "simulated-not-eligible";
  } else if (!completed) {
    result = `benchmark-${benchmark.status ?? "unknown"}`;
  } else if (!thresholdsMet) {
    result = "thresholds-not-met";
  } else if (!enoughSamples) {
    result = "insufficient-samples";
  } else if (requestedDurationSec < minimumDurationSec) {
    status = "short-run";
    result = "short-run-thresholds-met";
  } else if (!durationQualified) {
    result = "incomplete-duration";
  } else {
    status = "accepted";
    result = "accepted-30m";
  }

  return {
    status,
    result,
    exitCode: status === "failed" ? 1 : 0,
    completed,
    simulated,
    p99Us,
    p999Us,
    wkcErrors,
    lostFrames,
    samples,
    expectedSamples,
    sampleCoverage,
    p99ok,
    p999ok,
    wkcOk,
    enoughSamples,
    thresholdsMet,
    durationQualified,
    accepted,
    p99LimitUs,
    p999LimitUs,
    minimumDurationSec
  };
}
