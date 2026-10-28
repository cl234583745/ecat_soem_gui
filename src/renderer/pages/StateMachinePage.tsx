import { useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  CircleDot,
  Gauge,
  Workflow
} from "lucide-react";
import { ecatBridge } from "../lib/bridge";
import type { Snapshot, SlaveState } from "../../shared/types";
import {
  EmptyState,
  PageHeader,
  SectionHeader,
  SlaveStateBadge,
  Toggle,
  type Notify
} from "../components/ui";

const STATES: Array<{
  id: SlaveState;
  label: string;
  code: string;
  description: string;
}> = [
  {
    id: "INIT",
    label: "INIT",
    code: "0x01",
    description: "初始化，邮箱尚未启用"
  },
  {
    id: "PRE-OP",
    label: "PRE-OP",
    code: "0x02",
    description: "邮箱可用，过程数据停止"
  },
  {
    id: "SAFE-OP",
    label: "SAFE-OP",
    code: "0x04",
    description: "输入有效，输出保持安全值"
  },
  {
    id: "OP",
    label: "OP",
    code: "0x08",
    description: "输入输出周期交换"
  }
];

const stateIndex = (state: SlaveState) =>
  ["INIT", "PRE-OP", "SAFE-OP", "OP"].indexOf(state);

export function StateMachinePage({
  snapshot,
  notify
}: {
  snapshot: Snapshot;
  notify: Notify;
}) {
  const [busy, setBusy] = useState(false);
  const selected = snapshot.slaves.find(
    (slave) => slave.index === snapshot.selectedSlaveIndex
  );
  const currentIndex = selected ? stateIndex(selected.state) : -1;

  async function transition(index: number, target: SlaveState) {
    setBusy(true);
    const result = await ecatBridge.transitionSlave(index, target);
    notify(result.ok ? "success" : "error", result.message);
    setBusy(false);
  }

  async function transitionAll(target: SlaveState) {
    setBusy(true);
    const result = await ecatBridge.transitionAll(target);
    notify(result.ok ? "success" : "error", result.message);
    setBusy(false);
  }

  async function setAutoOp(value: boolean) {
    const result = await ecatBridge.updateConfig({ autoTransitionOp: value });
    notify(result.ok ? "success" : "error", result.message);
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="ETHERNET STATE MACHINE"
        title="从站状态机"
        actions={
          <>
            <button
              className="button button-ghost"
              onClick={() => void transitionAll("SAFE-OP")}
              disabled={busy || snapshot.slaves.length === 0}
            >
              <ArrowDownToLine size={16} />
              全部 SAFE-OP
            </button>
            <button
              className="button button-primary"
              onClick={() => void transitionAll("OP")}
              disabled={busy || snapshot.slaves.length === 0}
            >
              <ArrowUpFromLine size={16} />
              全部 OP
            </button>
          </>
        }
      />

      {!selected ? (
        <section className="panel">
          <EmptyState
            icon={<Workflow size={23} />}
            title="没有可操作的从站"
            detail="请先启动主站并扫描从站。"
          />
        </section>
      ) : (
        <div className="state-layout">
          <section className="panel state-machine-panel">
            <SectionHeader
              title={selected.name}
              detail={`SLAVE ${selected.index} · AL Status ${selected.alStatusCode}`}
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
                  <SlaveStateBadge state={selected.state} />
                </>
              }
            />

            <div className="state-canvas">
              <div className="state-track">
                {STATES.map((state, index) => {
                  const reached = index <= currentIndex;
                  const current = index === currentIndex;
                  return (
                    <div
                      className={
                        current
                          ? "state-stage current"
                          : reached
                            ? "state-stage reached"
                            : "state-stage"
                      }
                      key={state.id}
                    >
                      <button
                        className="state-orb"
                        disabled={busy || state.id === selected.state}
                        onClick={() =>
                          void transition(selected.index, state.id)
                        }
                        title={`切换到 ${state.label}`}
                      >
                        {reached ? <Check size={20} /> : <CircleDot size={17} />}
                      </button>
                      <div className="state-label">
                        <strong>{state.label}</strong>
                        <code>{state.code}</code>
                      </div>
                      <p>{state.description}</p>
                      {current ? <span className="current-marker">CURRENT</span> : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="state-detail-grid">
              <div>
                <span>AL Status Code</span>
                <strong>
                  0x{selected.alStatus.toString(16).padStart(4, "0")}
                </strong>
                <small>{selected.alStatusCode}</small>
              </div>
              <div>
                <span>Working Counter</span>
                <strong>{selected.wkc}</strong>
                <small>预期 {snapshot.telemetry.expectedWkc}</small>
              </div>
              <div>
                <span>Distributed Clock</span>
                <strong>{selected.dcEnabled ? "ON" : "OFF"}</strong>
                <small>
                  {snapshot.telemetry.dcOffsetNs} ns offset
                </small>
              </div>
              <div>
                <span>过程数据</span>
                <strong>
                  {selected.state === "OP" ? "CYCLIC" : "STOPPED"}
                </strong>
                <small>PDO 交换状态</small>
              </div>
            </div>
          </section>

          <aside className="state-aside">
            <section className="panel automation-panel">
              <SectionHeader title="状态自动化" />
              <Toggle
                checked={snapshot.config.autoTransitionOp}
                onChange={(value) => void setAutoOp(value)}
                label="扫描后自动 OP"
                detail="成功扫描后执行 PRE-OP → SAFE-OP → OP"
              />
              <div className="sequence">
                <span className="sequence-dot">
                  <span />
                </span>
                <div>
                  <strong>统一时序</strong>
                  <small>所有从站同步推进，单站失败即停止</small>
                </div>
              </div>
              <div className="sequence">
                <span className="sequence-dot amber">
                  <span />
                </span>
                <div>
                  <strong>OP 安全门槛</strong>
                  <small>WKC、AL Status 与 DC 偏差检查通过</small>
                </div>
              </div>
            </section>

            <section className="panel state-warning">
              <span className="warning-icon">
                <AlertTriangle size={19} />
              </span>
              <div>
                <strong>OP 切换会驱动真实输出</strong>
                <p>
                  接入真实设备时必须确认机械、安全回路与驱动器使能条件。
                </p>
              </div>
            </section>

            <section className="panel">
              <SectionHeader title="操作范围" />
              <div className="scope-row">
                <Gauge size={17} />
                <span>
                  <strong>当前从站</strong>
                  <small>#{selected.index} {selected.name}</small>
                </span>
              </div>
              <div className="scope-row">
                <Workflow size={17} />
                <span>
                  <strong>全部从站</strong>
                  <small>{snapshot.slaves.length} 个已扫描节点</small>
                </span>
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
