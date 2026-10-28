import { describe, expect, it } from "vitest";
import {
  expectedWorkingCounter,
  parseEthercatIndex,
  transitionPath
} from "./protocol";

describe("EtherCAT protocol helpers", () => {
  it("parses hexadecimal object indexes", () => {
    expect(parseEthercatIndex("6041")).toBe(0x6041);
    expect(parseEthercatIndex("0x1A00")).toBe(0x1a00);
  });

  it("rejects invalid object indexes", () => {
    expect(() => parseEthercatIndex("10000")).toThrow();
    expect(() => parseEthercatIndex("not-hex")).toThrow();
  });

  it("builds upward and downward state transition paths", () => {
    expect(transitionPath("PRE-OP", "OP")).toEqual(["SAFE-OP", "OP"]);
    expect(transitionPath("OP", "PRE-OP")).toEqual(["SAFE-OP", "PRE-OP"]);
  });

  it("uses master plus one working counter per slave", () => {
    expect(expectedWorkingCounter(0)).toBe(0);
    expect(expectedWorkingCounter(4)).toBe(5);
  });
});
