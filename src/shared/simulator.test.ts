import { describe, expect, it } from "vitest";
import { CoreSimulator } from "./simulator";

function simulator() {
  return new CoreSimulator({
    autoTick: false,
    latencyScale: 0,
    useDemoBus: false
  });
}

describe("CoreSimulator", () => {
  it("runs the connect, scan and auto-OP workflow", async () => {
    const core = simulator();
    const connected = await core.connect("npf:intel-i219");
    expect(connected.ok).toBe(true);
    expect(core.getSnapshot().phase).toBe("preop");

    const scanned = await core.scan();
    const snapshot = core.getSnapshot();
    expect(scanned.ok).toBe(true);
    expect(scanned.data).toBe(4);
    expect(snapshot.phase).toBe("op");
    expect(snapshot.slaves.every((slave) => slave.state === "OP")).toBe(true);
    expect(snapshot.telemetry.expectedWkc).toBe(5);
    core.dispose();
  });

  it("supports SDO and mailbox requests once the bus is up", async () => {
    const core = simulator();
    await core.scan();

    const read = await core.sdoRead({
      slaveIndex: 1,
      index: "6041",
      subIndex: 0,
      dataType: "UINT16"
    });
    expect(read.ok).toBe(true);
    expect(read.data?.valueHex).toBe("0237");

    const mailbox = await core.sendMailbox({
      slaveIndex: 1,
      protocol: "CoE",
      payloadHex: "4000416000000000"
    });
    expect(mailbox.ok).toBe(true);
    expect(mailbox.data?.responseHex).toHaveLength(16);
    core.dispose();
  });

  it("clamps unsafe cycle and timeout configuration", async () => {
    const core = simulator();
    await core.updateConfig({
      cycleUs: 10,
      sendTimeoutUs: 1,
      receiveTimeoutUs: 1,
      dedicatedCore: 99,
      retainFrames: 0
    });
    const config = core.getSnapshot().config;
    expect(config.cycleUs).toBe(250);
    expect(config.sendTimeoutUs).toBe(250);
    expect(config.receiveTimeoutUs).toBe(250);
    expect(config.dedicatedCore).toBe(63);
    expect(config.retainFrames).toBe(100);
    core.dispose();
  });

  it("rejects PDO writes outside OP", async () => {
    const core = simulator();
    const result = await core.writePdo(
      1,
      "0x6040",
      0,
      "0x000F"
    );
    expect(result.ok).toBe(false);
    core.dispose();
  });

  it("runs a simulated benchmark and locks bus operations", async () => {
    const core = simulator();
    await core.scan();
    const started = await core.benchmarkStart(10);
    expect(started.ok).toBe(true);
    expect(core.getSnapshot().benchmark.status).toBe("running");
    expect(core.getSnapshot().benchmark.simulated).toBe(true);

    const sdoDuringBenchmark = await core.sdoRead({
      slaveIndex: 1,
      index: "6041",
      subIndex: 0,
      dataType: "UINT16"
    });
    expect(sdoDuringBenchmark.ok).toBe(false);

    const stopped = await core.benchmarkStop();
    expect(stopped.ok).toBe(true);
    expect(core.getSnapshot().benchmark.status).toBe("stopped");
    core.dispose();
  });
});
