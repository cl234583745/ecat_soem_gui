import type { SlaveState } from "./types";

const STATE_ORDER: SlaveState[] = ["INIT", "PRE-OP", "SAFE-OP", "OP"];

export function stateRank(state: SlaveState): number {
  return STATE_ORDER.indexOf(state);
}

export function canTransition(
  current: SlaveState,
  target: SlaveState
): boolean {
  return stateRank(current) !== stateRank(target);
}

export function transitionPath(
  current: SlaveState,
  target: SlaveState
): SlaveState[] {
  const start = stateRank(current);
  const end = stateRank(target);
  if (start < end) {
    return STATE_ORDER.slice(start + 1, end + 1);
  }
  return STATE_ORDER.slice(end, start).reverse();
}

export function parseEthercatIndex(value: string): number {
  const normalized = value.trim().replace(/^0x/i, "");
  const parsed = Number.parseInt(normalized, 16);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0xffff) {
    throw new Error("对象索引必须是 0x0000 到 0xFFFF");
  }
  return parsed;
}

export function expectedWorkingCounter(slaveCount: number): number {
  return slaveCount > 0 ? slaveCount + 1 : 0;
}

export function limitHistory<T>(values: T[], limit: number): T[] {
  return values.length > limit ? values.slice(values.length - limit) : values;
}
