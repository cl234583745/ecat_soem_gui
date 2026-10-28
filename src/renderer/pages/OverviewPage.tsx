import { useState } from "react";
import {
  Box,
  Cable,
  ChevronRight,
  CircleDot,
  Download,
  Gauge,
  Network,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Square,
  Trash2
} from "lucide-react";
import { ecatBridge } from "../lib/bridge";
import { formatClock, formatDuration } from "../../shared/format";
import type { EcatSlave, Snapshot, SlaveState } from "../../shared/types";
import { TelemetryChart } from "../components/TelemetryChart";
import {
  ConnectionFacts,
  EmptyState,
  Kpi,
  LogIcon,
  PageHeader,
  SectionHeader,
  SlaveStateBadge,
  type Notify
} from "../components/ui";

function downloadSnapshot(snapshot: Snapshot) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ecat-bench-snapshot-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function TopologyRail({
  slaves,
  selected,
  onSelect
}: {
  slaves: EcatSlave[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  if (slaves.length === 0) {
    return (
      <EmptyState
        icon={<Network size={22} />}
        title="尚未扫描从站"
        detail="启动总线后执行扫描，从站拓扑将显示在这里。"
      />
    );
  }

  return (
    <div className="topology-scroll">
      <div className="topology-master">
        <span className="topology-node-icon master">
          <Server size={19} />
        </span>
        <span>
          <strong>MASTER</strong>
          <small>逻辑端口 0</small>
        </span>
      </div>
      {slaves.map((slave) => (
        <div className="topology-segment" key={slave.index}>
          <span className="topology-link">
            <Cable size={18} />
            <small>WKC {slave.wkc}</small>
          </span>
          <button
            className={
              selected === slave.index
                ? "topology-node selected"
                : "topology-node"
            }
            onClick={() => onSelect(slave.index)}
          >
            <span className={`topology-node-icon state-${slave.state.toLowerCase().replace("-", "")}`}>
              <Box size={18} />
            </span>
            <span className="topology-node-copy">
              <strong>
                <em>#{slave.index}</em> {slave.name}
              </strong>
              <small>{slave.productCode}</small>
            </span>
            <SlaveStateBadge state={slave.state} />
          </button>
        </div>
      ))}
    </div>
  );
}

function SelectedSlavePanel({
  slave,
  notify
}: {
  slave: EcatSlave | undefined;
  notify: Notify;
}) {
  const [busy, setBusy] = useState(false);
  if (!slave) {
    return (
      <section className="panel selected-slave-panel">
        <SectionHeader title="从站详情" />
        <EmptyState
          icon={<CircleDot size={21} />}
          title="未选择从站"
          detail="从拓扑中选择一个从站查看身份和过程数据。"
        />
      </section>
    );
  }
  const currentSlave = slave;

  async function transition(target: SlaveState) {
    setBusy(true);
    const result = await ecatBridge.transitionSlave(currentSlave.index, target);
    notify(result.ok ? "success" : "warning", result.message);
    setBusy(false);
  }

  return (
    <section className="panel selected-slave-panel">
      <SectionHeader
        title="从站详情"
        actions={<span className="mono muted">SLAVE {slave.index}</span>}
      />
      <div className="slave-identity">
        <div className="slave-avatar">
          <Box size={22} />
        </div>
        <div>
          <strong>{slave.name}</strong>
          <span>{slave.productCode} · Rev {slave.revision}</span>
        </div>
        <SlaveStateBadge state={slave.state} />
      </div>
      <dl className="fact-grid">
        <div>
          <dt>Vendor ID</dt>
          <dd>{slave.vendorId}</dd>
        </div>
        <div>
          <dt>Serial</dt>
          <dd>{slave.serial}</dd>
        </div>
        <div>
          <dt>AL Status</dt>
          <dd>0x{slave.alStatus.toString(16).padStart(4, "0")}</dd>
        </div>
        <div>
          <dt>Distributed Clock</dt>
          <dd>{slave.dcEnabled ? "Enabled" : "Disabled"}</dd>
        </div>
        <div>
          <dt>Input PDO</dt>
          <dd>{slave.inputs.length} objects</dd>
        </div>
        <div>
          <dt>Output PDO</dt>
          <dd>{slave.outputs.length} objects</dd>
        </div>
      </dl>
      <div className="protocol-row">
        {slave.mailboxProtocols.map((protocol) => (
          <span className="token" key={protocol}>
            {protocol}
          </span>
        ))}
      </div>
      <div className="quick-state">
        <span>状态切换</span>
        <div className="segmented compact">
          {(["PRE-OP", "SAFE-OP", "OP"] as SlaveState[]).map((state) => (
            <button
              key={state}
              disabled={busy || slave.state === state}
              className={slave.state === state ? "active" : ""}
              onClick={() => void transition(state)}
            >
              {state}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function ConnectionPanel({
  snapshot,
  notify
}: {
  snapshot: Snapshot;
  notify: Notify;
}) {
  const [busy, setBusy] = useState(false);
  const adapter = snapshot.adapters.find(
    (item) => item.id === snapshot.selectedAdapterId
  );

  async function selectAdapter(adapterId: string) {
    const result = await ecatBridge.selectAdapter(adapterId);
    notify(result.ok ? "success" : "warning", result.message);
  }

  async function toggleBus() {
    setBusy(true);
    const result = snapshot.connected
      ? await ecatBridge.disconnect()
      : await ecatBridge.connect(snapshot.selectedAdapterId);
    notify(result.ok ? "success" : "error", result.message);
    setBusy(false);
  }

  async function scan() {
    setBusy(true);
    const result = await ecatBridge.scan();
    notify(result.ok ? "success" : "error", result.message);
    setBusy(false);
  }

  return (
    <section className="panel connection-panel">
      <SectionHeader
        title="主站连接"
        actions={
          <span className={snapshot.connected ? "link-state live" : "link-state"}>
            <span />
            {snapshot.connected ? "链路在线" : "链路离线"}
          </span>
        }
      />
      <div className="connection-state">
        <span className={`large-state phase-${snapshot.phase}`}>
          {snapshot.phase === "op"
            ? "OP"
            : snapshot.phase === "safeop"
              ? "SAFE-OP"
              : snapshot.phase === "preop"
                ? "PRE-OP"
                : snapshot.phase === "connecting"
                  ? "INIT"
                  : "OFF"}
        </span>
        <div>
          <strong>
            {snapshot.phase === "op" ? "周期数据交换中" : "等待主站操作"}
          </strong>
          <span>
            {snapshot.connected
              ? `${formatDuration(snapshot.counters.uptimeSec)} · ${snapshot.counters.cycles.toLocaleString()} cycles`
              : "总线未占用网卡资源"}
          </span>
        </div>
      </div>
      <label className="field">
        <span className="field-label">EtherCAT 网卡</span>
        <select
          value={snapshot.selectedAdapterId}
          onChange={(event) => void selectAdapter(event.target.value)}
          disabled={snapshot.connected}
        >
          {snapshot.adapters.map((item) => (
            <option value={item.id} key={item.id}>
              {item.name} · {item.linkUp ? "Link UP" : "Link DOWN"}
            </option>
          ))}
        </select>
      </label>
      <div className="adapter-summary">
        <span className={adapter?.dedicated ? "tag tag-good" : "tag tag-warn"}>
          {adapter?.dedicated ? "专用" : "共享"}
        </span>
        <span className="mono">{adapter?.mac}</span>
        <span>{adapter?.driver}</span>
      </div>
      <div className="button-row">
        <button className="button button-primary grow" onClick={() => void scan()} disabled={busy}>
          <RefreshCw size={16} className={snapshot.scanning ? "spin" : ""} />
          {snapshot.scanning ? "扫描中" : "扫描从站"}
        </button>
        <button
          className={snapshot.connected ? "button button-danger-subtle" : "button button-default"}
          onClick={() => void toggleBus()}
          disabled={busy || snapshot.phase === "connecting"}
        >
          {snapshot.connected ? <Square size={14} /> : <Play size={14} />}
          {snapshot.connected ? "停止" : "启动"}
        </button>
      </div>
    </section>
  );
}

export function OverviewPage({
  snapshot,
  notify
}: {
  snapshot: Snapshot;
  notify: Notify;
}) {
  const selected =
    snapshot.slaves.find(
      (slave) => slave.index === snapshot.selectedSlaveIndex
    ) ?? snapshot.slaves[0];
  const wkcHealthy =
    snapshot.telemetry.expectedWkc > 0 &&
    snapshot.telemetry.wkc === snapshot.telemetry.expectedWkc;

  async function selectSlave(index: number) {
    await ecatBridge.selectSlave(index);
  }

  return (
    <div className="page overview-page">
      <PageHeader
        eyebrow="BUS OVERVIEW"
        title="总线总览"
        actions={
          <button
            className="button button-ghost"
            onClick={() => {
              downloadSnapshot(snapshot);
              notify("success", "诊断快照已导出");
            }}
          >
            <Download size={16} />
            导出快照
          </button>
        }
      />

      <div className="overview-grid">
        <div className="overview-main">
          <div className="kpi-grid">
            <Kpi
              label="主站状态"
              value={
                snapshot.phase === "op"
                  ? "OP"
                  : snapshot.phase === "safeop"
                    ? "SAFE-OP"
                    : snapshot.phase === "preop"
                      ? "PRE-OP"
                      : snapshot.phase.toUpperCase()
              }
              tone={
                snapshot.phase === "op"
                  ? "good"
                  : snapshot.phase === "error"
                    ? "error"
                    : "warning"
              }
              hint={snapshot.connected ? "EtherCAT 运行中" : "主站已停止"}
            />
            <Kpi
              label="通信周期"
              value={(snapshot.telemetry.cycleUs / 1000).toFixed(2)}
              suffix="ms"
              hint={`设定 ${snapshot.config.cycleUs / 1000} ms`}
            />
            <Kpi
              label="工作计数器"
              value={`${snapshot.telemetry.wkc}/${snapshot.telemetry.expectedWkc}`}
              tone={wkcHealthy ? "good" : "error"}
              hint={wkcHealthy ? "所有从站响应" : "检查断链或从站状态"}
            />
            <Kpi
              label="周期抖动"
              value={`${snapshot.telemetry.jitterUs}`}
              suffix="µs"
              tone={snapshot.telemetry.jitterUs < 100 ? "good" : "warning"}
              hint={`DC 偏差 ${snapshot.telemetry.dcOffsetNs} ns`}
            />
            <Kpi
              label="在线从站"
              value={`${snapshot.slaves.length}`}
              suffix="台"
              hint={`${snapshot.counters.lostFrames} 丢帧 · ${snapshot.counters.workingCounterErrors} WKC 错误`}
            />
          </div>

          <section className="panel topology-panel">
            <SectionHeader
              title="总线拓扑"
              detail={
                snapshot.connected
                  ? `${snapshot.slaves.length} 个从站在线`
                  : "主站未启动"
              }
              actions={
                <button
                  className="text-button"
                  onClick={() => {
                    void ecatBridge.scan().then((result) => {
                      notify(result.ok ? "success" : "warning", result.message);
                    });
                  }}
                >
                  <RefreshCw size={14} />
                  重新扫描
                </button>
              }
            />
            <TopologyRail
              slaves={snapshot.slaves}
              selected={selected?.index ?? 0}
              onSelect={(index) => void selectSlave(index)}
            />
          </section>

          <div className="chart-grid">
            <section className="panel chart-panel">
              <SectionHeader
                title="周期时间"
                actions={
                  <span className="metric-inline">
                    <Gauge size={15} />
                    {(snapshot.telemetry.cycleUs / 1000).toFixed(3)} ms
                  </span>
                }
              />
              <TelemetryChart history={snapshot.history} metric="cycleUs" />
            </section>
            <section className="panel chart-panel">
              <SectionHeader
                title="周期抖动"
                actions={
                  <span className="metric-inline amber">
                    <ShieldCheck size={15} />
                    {snapshot.telemetry.jitterUs} µs
                  </span>
                }
              />
              <TelemetryChart
                history={snapshot.history}
                metric="jitterUs"
                color="#c36b0b"
              />
            </section>
          </div>

          <section className="panel event-panel">
            <SectionHeader
              title="运行事件"
              detail={`${snapshot.logs.length} 条记录`}
              actions={
                <button
                  className="text-button"
                  onClick={() => {
                    void ecatBridge.clearLogs();
                  }}
                >
                  <Trash2 size={14} />
                  清空
                </button>
              }
            />
            <div className="event-list">
              {snapshot.logs.slice(0, 8).map((entry) => (
                <div className={`event-row level-${entry.level}`} key={entry.id}>
                  <span className="event-icon">
                    <LogIcon level={entry.level} />
                  </span>
                  <span className="event-time mono">{formatClock(entry.at)}</span>
                  <span className="event-source">{entry.source}</span>
                  <span className="event-message">{entry.message}</span>
                </div>
              ))}
              {snapshot.logs.length === 0 ? (
                <div className="event-empty">暂无运行事件</div>
              ) : null}
            </div>
          </section>
        </div>

        <aside className="overview-aside">
          <ConnectionPanel snapshot={snapshot} notify={notify} />
          <SelectedSlavePanel slave={selected} notify={notify} />
          <section className="panel health-panel">
            <SectionHeader title="核心保障" />
            <div className="health-list">
              <div>
                <span className="health-icon good">
                  <ShieldCheck size={16} />
                </span>
                <span>
                  <strong>周期线程隔离</strong>
                  <small>GUI 不参与实时收发</small>
                </span>
                <ChevronRight size={15} />
              </div>
              <div>
                <span className="health-icon good">
                  <Cable size={16} />
                </span>
                <span>
                  <strong>Receive timeout</strong>
                  <small>{snapshot.config.receiveTimeoutUs} µs</small>
                </span>
                <ChevronRight size={15} />
              </div>
              <div>
                <span className="health-icon">
                  <Server size={16} />
                </span>
                <span>
                  <strong>网络适配器</strong>
                  <small>
                    {snapshot.adapters.find(
                      (adapter) => adapter.id === snapshot.selectedAdapterId
                    )?.description ?? "--"}
                  </small>
                </span>
                <ChevronRight size={15} />
              </div>
            </div>
            <ConnectionFacts snapshot={snapshot} />
          </section>
        </aside>
      </div>
    </div>
  );
}
