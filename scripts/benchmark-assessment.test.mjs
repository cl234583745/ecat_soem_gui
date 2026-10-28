import assert from "node:assert/strict";
import test from "node:test";
import { assessBenchmark } from "./benchmark-assessment.mjs";

function benchmark(overrides = {}) {
  return {
    status: "completed",
    durationSec: 1800,
    elapsedSec: 1800,
    samples: 1_800_000,
    cycleTime: { p99Us: 1008, p999Us: 1120 },
    wkcErrors: 0,
    lostFrames: 0,
    ...overrides
  };
}

test("accepts a qualified 30-minute hardware run", () => {
  const result = assessBenchmark(benchmark());
  assert.equal(result.status, "accepted");
  assert.equal(result.result, "accepted-30m");
  assert.equal(result.exitCode, 0);
  assert.equal(result.accepted, true);
});

test("marks a completed 60-second run as short-run only", () => {
  const result = assessBenchmark(
    benchmark({
      durationSec: 60,
      elapsedSec: 60,
      samples: 60_000
    })
  );
  assert.equal(result.status, "short-run");
  assert.equal(result.result, "short-run-thresholds-met");
  assert.equal(result.exitCode, 0);
  assert.equal(result.accepted, false);
});

test("fails when the p99.9 threshold is exceeded", () => {
  const result = assessBenchmark(
    benchmark({ cycleTime: { p99Us: 1000, p999Us: 1250 } })
  );
  assert.equal(result.status, "failed");
  assert.equal(result.result, "thresholds-not-met");
  assert.equal(result.exitCode, 1);
});

test("fails a full-duration run that stopped early", () => {
  const result = assessBenchmark(
    benchmark({
      elapsedSec: 900,
      samples: 900_000
    })
  );
  assert.equal(result.status, "failed");
  assert.equal(result.result, "incomplete-duration");
  assert.equal(result.exitCode, 1);
});

test("does not accept simulated benchmark data", () => {
  const result = assessBenchmark(benchmark({ simulated: true }));
  assert.equal(result.status, "failed");
  assert.equal(result.result, "simulated-not-eligible");
  assert.equal(result.exitCode, 1);
});
