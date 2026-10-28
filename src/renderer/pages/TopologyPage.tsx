import { useMemo, useState } from "react";
import {
  Box,
  Cable,
  ChevronRight,
  Network,
  RefreshCw,
  Search,
  Workflow
} from "lucide-react";
import { ecatBridge } from "../lib/bridge";
import type { Snapshot, SlaveState } from "../../shared/types";
import {
  EmptyState,
  PageHeader,
  SectionHeader,
  SlaveStateBadge,
  type Notify
} from "../components/ui";

export function TopologyPage({
  snapshot,
  notify
}: {
  snapshot: Snapshot;
  notify: Notify;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = snapshot.slaves.find(
    (slave) => slave.index === snapshot.selectedSlaveIndex
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return snapshot.slaves;
    }
    return snapshot.slaves.filter(
      (slave) =>
        slave.name.toLowerCase().includes(normalized) ||
        slave.productCode.toLowerCase().includes(normalized) ||
        String(slave.index).includes(normalized)
    );
  }, [query, snapshot.slaves]);

  async function scan() {
    setBusy(true);
    const result = await ecatBridge.scan();
    notify(result.ok ? "success" : "error", result.message);
    setBusy(false);
  }

  async function transitionAll(target: SlaveState) {
    setBusy(true);
    const result = await ecatBridge.transitionAll(target);
    notify(result.ok ? "success" : "error", result.message);
    setBusy(false);
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="SLAVE TOPOLOGY"
        title="从站拓扑"
        actions={
          <>
            <button
              className="button button-ghost"
              onClick={() => void transitionAll("OP")}
              disabled={busy || snapshot.slaves.length === 0}
            >
              <Workflow size={16} />
              全部切 OP
            </button>
            <button className="button button-primary" onClick={() => void scan()} disabled={busy}>
              <RefreshCw size={16} className={snapshot.scanning ? "spin" : ""} />
              {snapshot.scanning ? "扫描中" : "扫描总线"}
            </button>
          </>
        }
      />

      <div className="topology-summary">
        <div>
          <span className="summary-icon">
            <Network size={18} />
          </span>
          <span>
            <small>在线从站</small>
            <strong>{snapshot.slaves.length}</strong>
          </span>
        </div>
        <div>
          <span className="summary-icon">
            <Cable size={18} />
          </span>
          <span>
            <small>拓扑断点</small>
            <strong>{snapshot.slaves.length > 0 ? "0" : "--"}</strong>
          </span>
        </div>
        <div>
          <span className="summary-icon">
            <Workflow size={18} />
          </span>
          <span>
            <small>OP 从站</small>
            <strong>
              {snapshot.slaves.filter((slave) => slave.state === "OP").length}/
              {snapshot.slaves.length}
            </strong>
          </span>
        </div>
        <div>
          <span className="summary-icon">
            <Box size={18} />
          </span>
          <span>
            <small>期望 WKC</small>
            <strong>{snapshot.telemetry.expectedWkc}</strong>
          </span>
        </div>
      </div>

      <div className="topology-layout">
        <section className="panel table-panel">
          <SectionHeader
            title="从站列表"
            detail={`${filtered.length} / ${snapshot.slaves.length} 条记录`}
            actions={
              <label className="search-box">
                <Search size={15} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索名称、索引或产品码"
                />
              </label>
            }
          />
          {snapshot.slaves.length === 0 ? (
            <EmptyState
              icon={<Network size={22} />}
              title="没有发现的从站"
              detail="检查物理链路和网卡选择后重新扫描。"
            />
          ) : (
            <div className="data-table-wrap">
              <table className="data-table topology-table">
                <thead>
                  <tr>
                    <th>位置</th>
                    <th>从站名称</th>
                    <th>Vendor / Product</th>
                    <th>状态</th>
                    <th>AL Status</th>
                    <th>WKC</th>
                    <th>DC</th>
                    <th aria-label="查看" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((slave) => (
                    <tr
                      key={slave.index}
                      className={
                        slave.index === snapshot.selectedSlaveIndex ? "selected" : ""
                      }
                      onClick={() => void ecatBridge.selectSlave(slave.index)}
                    >
                      <td>
                        <span className="slave-index">{slave.index}</span>
                      </td>
                      <td>
                        <strong>{slave.name}</strong>
                        <small>{slave.serial}</small>
                      </td>
                      <td>
                        <code>{slave.vendorId}</code>
                        <small>{slave.productCode}</small>
                      </td>
                      <td>
                        <SlaveStateBadge state={slave.state} />
                      </td>
                      <td>
                        <code>
                          0x{slave.alStatus.toString(16).padStart(4, "0")}
                        </code>
                      </td>
                      <td className="mono">{slave.wkc}</td>
                      <td>
                        <span className={slave.dcEnabled ? "dot-label live" : "dot-label"}>
                          <span />
                          {slave.dcEnabled ? "ON" : "OFF"}
                        </span>
                      </td>
                      <td>
                        <ChevronRight size={16} className="row-chevron" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="panel slave-inspector">
          <SectionHeader
            title="身份与诊断"
            actions={
              selected ? (
                <SlaveStateBadge state={selected.state} />
              ) : (
                <span className="muted">--</span>
              )
            }
          />
          {selected ? (
            <>
              <div className="inspector-name">
                <span className="slave-avatar">
                  <Box size={22} />
                </span>
                <div>
                  <strong>{selected.name}</strong>
                  <small>
                    Position #{selected.index} · {selected.revision}
                  </small>
                </div>
              </div>
              <dl className="detail-list">
                <div>
                  <dt>Vendor ID</dt>
                  <dd>{selected.vendorId}</dd>
                </div>
                <div>
                  <dt>Product code</dt>
                  <dd>{selected.productCode}</dd>
                </div>
                <div>
                  <dt>Revision</dt>
                  <dd>{selected.revision}</dd>
                </div>
                <div>
                  <dt>Serial number</dt>
                  <dd>{selected.serial}</dd>
                </div>
                <div>
                  <dt>AL status code</dt>
                  <dd>{selected.alStatusCode}</dd>
                </div>
                <div>
                  <dt>Mailbox</dt>
                  <dd>{selected.mailboxProtocols.join(" / ")}</dd>
                </div>
                <div>
                  <dt>Inputs / Outputs</dt>
                  <dd>
                    {selected.inputs.length} / {selected.outputs.length}
                  </dd>
                </div>
                <div>
                  <dt>Working counter</dt>
                  <dd>{selected.wkc}</dd>
                </div>
              </dl>
              <div className="inspector-actions">
                <button
                  className="button button-default grow"
                  onClick={() => void transitionAll("SAFE-OP")}
                  disabled={busy}
                >
                  SAFE-OP
                </button>
                <button
                  className="button button-primary grow"
                  onClick={() => void transitionAll("OP")}
                  disabled={busy}
                >
                  全部 OP
                </button>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Box size={21} />}
              title="未选择从站"
              detail="在左侧列表中选择一个从站。"
            />
          )}
        </aside>
      </div>
    </div>
  );
}
