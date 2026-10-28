import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Box,
  CircleCheck,
  PencilLine,
  Radio
} from "lucide-react";
import type { PdoEntry, Snapshot } from "../../shared/types";
import { ecatBridge } from "../lib/bridge";
import {
  EmptyState,
  PageHeader,
  SectionHeader,
  type Notify
} from "../components/ui";

function PdoTable({
  entries,
  outputs,
  drafts,
  onChange,
  onWrite,
  busy
}: {
  entries: PdoEntry[];
  outputs: boolean;
  drafts: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onWrite: (entry: PdoEntry) => void;
  busy: boolean;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={outputs ? <ArrowUpFromLine size={21} /> : <ArrowDownToLine size={21} />}
        title={outputs ? "没有输出 PDO" : "没有输入 PDO"}
        detail="当前从站或 ENI 未声明该方向的过程数据。"
      />
    );
  }
  return (
    <div className="data-table-wrap">
      <table className="data-table pdo-table">
        <thead>
          <tr>
            <th>Index</th>
            <th>对象名称</th>
            <th>数据类型</th>
            <th>当前值</th>
            <th>Unit</th>
            <th>Access</th>
            {outputs ? <th aria-label="写入" /> : null}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const key = `${entry.index}:${entry.subIndex}`;
            return (
              <tr key={key}>
                <td>
                  <code>{entry.index}</code>
                  <small>:{entry.subIndex.toString(16).padStart(2, "0")}</small>
                </td>
                <td>
                  <strong>{entry.name}</strong>
                </td>
                <td>
                  <span className="tag">{entry.type}</span>
                </td>
                <td>
                  {outputs ? (
                    <input
                      className="table-input"
                      value={drafts[key] ?? entry.value}
                      onChange={(event) => onChange(key, event.target.value)}
                    />
                  ) : (
                    <code className="live-value">{entry.value}</code>
                  )}
                </td>
                <td>{entry.unit ?? "--"}</td>
                <td>
                  <span className={entry.writable ? "access-tag rw" : "access-tag"}>
                    {entry.writable ? "R/W" : "RO"}
                  </span>
                </td>
                {outputs ? (
                  <td>
                    <button
                      className="icon-button"
                      onClick={() => onWrite(entry)}
                      disabled={busy || !entry.writable}
                      title="写入过程映像"
                    >
                      <PencilLine size={15} />
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PdoPage({
  snapshot,
  notify
}: {
  snapshot: Snapshot;
  notify: Notify;
}) {
  const [direction, setDirection] = useState<"inputs" | "outputs">("outputs");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const selected = snapshot.slaves.find(
    (slave) => slave.index === snapshot.selectedSlaveIndex
  );
  const entries = selected?.[direction] ?? [];

  async function write(entry: PdoEntry) {
    if (!selected) {
      return;
    }
    const key = `${entry.index}:${entry.subIndex}`;
    const value = drafts[key] ?? entry.value;
    setBusy(true);
    const result = await ecatBridge.writePdo(
      selected.index,
      entry.index,
      entry.subIndex,
      value
    );
    notify(result.ok ? "success" : "error", result.message);
    setBusy(false);
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="PROCESS DATA"
        title="PDO 过程数据"
        actions={
          <span className={snapshot.phase === "op" ? "live-chip" : "live-chip idle"}>
            <Radio size={15} />
            {snapshot.phase === "op" ? "周期刷新" : "周期停止"}
          </span>
        }
      />

      {!selected ? (
        <section className="panel">
          <EmptyState
            icon={<ArrowLeftRight size={23} />}
            title="没有可查看的过程数据"
            detail="启动主站并扫描从站后，PDO 映像将显示在这里。"
          />
        </section>
      ) : (
        <>
          <div className="pdo-summary-grid">
            <div className="summary-tile">
              <span className="summary-icon">
                <Box size={18} />
              </span>
              <span>
                <small>Selected slave</small>
                <strong>
                  #{selected.index} {selected.name}
                </strong>
              </span>
            </div>
            <div className="summary-tile">
              <span className="summary-icon">
                <ArrowDownToLine size={18} />
              </span>
              <span>
                <small>Input PDO</small>
                <strong>{selected.inputs.length} objects</strong>
              </span>
            </div>
            <div className="summary-tile">
              <span className="summary-icon">
                <ArrowUpFromLine size={18} />
              </span>
              <span>
                <small>Output PDO</small>
                <strong>{selected.outputs.length} objects</strong>
              </span>
            </div>
            <div className="summary-tile">
              <span className="summary-icon">
                <CircleCheck size={18} />
              </span>
              <span>
                <small>Working counter</small>
                <strong>
                  {snapshot.telemetry.wkc}/{snapshot.telemetry.expectedWkc}
                </strong>
              </span>
            </div>
          </div>

          <section className="panel pdo-panel">
            <SectionHeader
              title="过程数据映像"
              detail="输入数据每周期刷新；输出写入后进入下一周期报文。"
              actions={
                <>
                  <select
                    value={snapshot.selectedSlaveIndex}
                    onChange={(event) =>
                      void ecatBridge.selectSlave(Number(event.target.value))
                    }
                  >
                    {snapshot.slaves.map((slave) => (
                      <option key={slave.index} value={slave.index}>
                        #{slave.index} {slave.name}
                      </option>
                    ))}
                  </select>
                  <div className="segmented">
                    <button
                      className={direction === "inputs" ? "active" : ""}
                      onClick={() => setDirection("inputs")}
                    >
                      Inputs
                      <span>{selected.inputs.length}</span>
                    </button>
                    <button
                      className={direction === "outputs" ? "active" : ""}
                      onClick={() => setDirection("outputs")}
                    >
                      Outputs
                      <span>{selected.outputs.length}</span>
                    </button>
                  </div>
                </>
              }
            />
            <PdoTable
              entries={entries}
              outputs={direction === "outputs"}
              drafts={drafts}
              onChange={(key, value) =>
                setDrafts((current) => ({ ...current, [key]: value }))
              }
              onWrite={(entry) => void write(entry)}
              busy={busy}
            />
          </section>
        </>
      )}
    </div>
  );
}
