import { useEffect, useState } from "react";
import {
  Activity,
  Cpu,
  FileCode2,
  Gauge,
  Network,
  Play,
  RefreshCw,
  Save,
  ShieldAlert,
  Square,
  Timer,
  Usb
} from "lucide-react";
import { ecatBridge } from "../lib/bridge";
import type { MasterConfig, Snapshot } from "../../shared/types";
import {
  Field,
  PageHeader,
  SectionHeader,
  Toggle,
  type Notify
} from "../components/ui";

export function AdaptersPage({
  snapshot,
  notify
}: {
  snapshot: Snapshot;
  notify: Notify;
}) {
  const [draft, setDraft] = useState<MasterConfig>(snapshot.config);
  const [saving, setSaving] = useState(false);
  const [benchmarkSeconds, setBenchmarkSeconds] = useState(60);
  const [refreshingAdapters, setRefreshingAdapters] = useState(false);

  useEffect(() => {
    setDraft(snapshot.config);
  }, [snapshot.config]);

  function set<K extends keyof MasterConfig>(key: K, value: MasterConfig[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function selectAdapter(adapterId: string) {
    set("adapterId", adapterId);
    const result = await ecatBridge.selectAdapter(adapterId);
    notify(result.ok ? "success" : "warning", result.message);
  }

  async function save() {
    setSaving(true);
    const result = await ecatBridge.updateConfig(draft);
    notify(result.ok ? "success" : "error", result.message);
    setSaving(false);
  }

  async function loadEni() {
    const result = await ecatBridge.loadEni();
    if (result) {
      notify(result.ok ? "success" : "error", result.message);
    }
  }

  async function refreshAdapters() {
    setRefreshingAdapters(true);
    try {
      const adapters = await ecatBridge.listAdapters();
      notify(
        adapters.length > 0 ? "success" : "warning",
        adapters.length > 0
          ? `网卡列表已刷新，发现 ${adapters.length} 个可用适配器`
          : "未发现可用的 NPF 网卡，请检查 Npcap 与管理员权限"
      );
    } catch (error) {
      notify(
        "error",
        error instanceof Error ? error.message : "刷新网卡列表失败"
      );
    } finally {
      setRefreshingAdapters(false);
    }
  }

  async function toggleBenchmark() {
    const running = snapshot.benchmark.status === "running";
    const result = running
      ? await ecatBridge.benchmarkStop()
      : await ecatBridge.benchmarkStart(benchmarkSeconds);
    notify(result.ok ? "success" : "error", result.message);
  }

  const benchmark = snapshot.benchmark;
  const benchmarkStatus: Record<typeof benchmark.status, string> = {
    idle: "未运行",
    running: "采集中",
    completed: "已完成",
    stopped: "已停止",
    aborted: "已中止"
  };
  const benchmarkRunning = benchmark.status === "running";
  const benchmarkReady =
    snapshot.connected &&
    snapshot.phase === "op" &&
    snapshot.capabilities.realtimeBenchmark !== false;

  return (
    <div className="page">
      <PageHeader
        eyebrow="NETWORK & TIMING"
        title="网卡与周期"
        actions={
          <button className="button button-primary" onClick={() => void save()} disabled={saving}>
            <Save size={16} />
            {saving ? "应用中" : "应用配置"}
          </button>
        }
      />

      <div className="settings-layout">
        <div className="settings-main">
          <section className="panel">
            <SectionHeader
              title="EtherCAT 网络适配器"
              detail="实时主站建议独占一块物理网卡，并关闭同一适配器上的 TCP/IP 服务。"
              actions={
                <button
                  className="text-button"
                  onClick={() => void refreshAdapters()}
                  disabled={refreshingAdapters || snapshot.connected}
                  title={
                    snapshot.connected
                      ? "停止总线后才能重新枚举网卡"
                      : "重新枚举 NPF 网卡"
                  }
                >
                  <RefreshCw
                    size={14}
                    className={refreshingAdapters ? "spin" : ""}
                  />
                  {refreshingAdapters ? "刷新中" : "刷新列表"}
                </button>
              }
            />
            <div className="adapter-list">
              {snapshot.adapters.map((adapter) => {
                const selected = draft.adapterId === adapter.id;
                return (
                  <button
                    key={adapter.id}
                    className={selected ? "adapter-item selected" : "adapter-item"}
                    onClick={() => void selectAdapter(adapter.id)}
                    disabled={snapshot.connected}
                  >
                    <span className="adapter-icon">
                      {adapter.name.toLowerCase().includes("usb") ? (
                        <Usb size={20} />
                      ) : (
                        <Network size={20} />
                      )}
                    </span>
                    <span className="adapter-copy">
                      <span>
                        <strong>{adapter.name}</strong>
                        {adapter.dedicated ? (
                          <em className="tag tag-good">专用</em>
                        ) : (
                          <em className="tag tag-warn">共享</em>
                        )}
                      </span>
                      <small>{adapter.description}</small>
                    </span>
                    <span className="adapter-meta">
                      <span className={adapter.linkUp ? "link-state live" : "link-state"}>
                        <span />
                        {adapter.linkUp ? "LINK UP" : "LINK DOWN"}
                      </span>
                      <code>{adapter.mac}</code>
                    </span>
                    <span className={selected ? "radio-mark active" : "radio-mark"} />
                  </button>
                );
              })}
            </div>
            {snapshot.adapters.length === 0 ? (
              <div className="inline-notice">
                <ShieldAlert size={16} />
                未发现可用网卡。请确认 Npcap 已安装、总线已停止，并重新刷新列表。
              </div>
            ) : null}
            {snapshot.connected ? (
              <div className="inline-notice">
                <ShieldAlert size={16} />
                停止总线后才能切换适配器。
              </div>
            ) : null}
          </section>

          <section className="panel">
            <SectionHeader
              title="循环时序"
              detail="周期、超时与调度参数会写入核心配置。"
            />
            <div className="form-grid">
              <Field label="通信周期" hint="建议 1000 µs；最低 250 µs">
                <div className="input-unit">
                  <input
                    type="number"
                    min={250}
                    max={10000}
                    step={250}
                    value={draft.cycleUs}
                    onChange={(event) => set("cycleUs", Number(event.target.value))}
                  />
                  <span>µs</span>
                </div>
              </Field>
              <Field label="发送超时" hint="不得小于通信周期">
                <div className="input-unit">
                  <input
                    type="number"
                    min={draft.cycleUs}
                    step={100}
                    value={draft.sendTimeoutUs}
                    onChange={(event) =>
                      set("sendTimeoutUs", Number(event.target.value))
                    }
                  />
                  <span>µs</span>
                </div>
              </Field>
              <Field label="接收超时" hint="SOEM receive timeout">
                <div className="input-unit">
                  <input
                    type="number"
                    min={draft.cycleUs}
                    step={100}
                    value={draft.receiveTimeoutUs}
                    onChange={(event) =>
                      set("receiveTimeoutUs", Number(event.target.value))
                    }
                  />
                  <span>µs</span>
                </div>
              </Field>
              <Field label="实时核心" hint="Windows 建议为周期线程保留独立 CPU">
                <div className="input-unit">
                  <input
                    type="number"
                    min={0}
                    max={63}
                    value={draft.dedicatedCore}
                    onChange={(event) =>
                      set("dedicatedCore", Number(event.target.value))
                    }
                  />
                  <span>CPU</span>
                </div>
              </Field>
            </div>
            <div className="toggle-grid">
              <Toggle
                checked={draft.realtimePriority}
                onChange={(value) => set("realtimePriority", value)}
                label="最高实时优先级"
                detail="提升周期线程调度优先级"
              />
              <Toggle
                checked={draft.distributedClock}
                onChange={(value) => set("distributedClock", value)}
                label="启用 Distributed Clock"
                detail="使用 DC 同步从站时钟"
              />
              <Toggle
                checked={draft.autoTransitionOp}
                onChange={(value) => set("autoTransitionOp", value)}
                label="扫描后自动进入 OP"
                detail="跳过人工状态确认"
              />
            </div>
          </section>

          <section className="panel">
            <SectionHeader
              title="ENI 与过程数据"
              detail="当前仅登记 ENI 路径；PDO 映射仍由 SOEM 自动配置。"
              actions={
                <button className="button button-default" onClick={() => void loadEni()}>
                  <FileCode2 size={15} />
                  导入 ENI
                </button>
              }
            />
            <div className="eni-row">
              <span className={draft.eniPath ? "eni-icon loaded" : "eni-icon"}>
                <FileCode2 size={20} />
              </span>
              <div>
                <strong>{draft.eniPath || "未加载 ENI"}</strong>
                <small>
                  {draft.eniPath
                    ? "已登记路径；本次运行仍使用 SOEM 自动映射"
                    : "当前使用 SOEM 自动配置模式"}
                </small>
              </div>
              {draft.eniPath ? <span className="tag">仅登记</span> : null}
            </div>
          </section>

          <section className="panel benchmark-panel">
            <SectionHeader
              title="1 ms 实时基准"
              detail="由周期线程直接采样收发耗时和绝对调度误差；运行期间锁定扫描、状态切换、SDO、PDO 与 FoE。"
              actions={
                <div className="benchmark-controls">
                  <label className="benchmark-duration">
                    <span>时长</span>
                    <input
                      type="number"
                      min={10}
                      max={28800}
                      step={10}
                      value={benchmarkSeconds}
                      disabled={benchmarkRunning}
                      onChange={(event) =>
                        setBenchmarkSeconds(Number(event.target.value))
                      }
                    />
                    <span>秒</span>
                  </label>
                  <button
                    className={
                      benchmarkRunning
                        ? "button button-danger-subtle"
                        : "button button-primary"
                    }
                    disabled={!benchmarkRunning && !benchmarkReady}
                    onClick={() => void toggleBenchmark()}
                  >
                    {benchmarkRunning ? <Square size={14} /> : <Play size={15} />}
                    {benchmarkRunning ? "停止基准" : "开始基准"}
                  </button>
                </div>
              }
            />
            <div className="benchmark-summary">
              <span
                className={`benchmark-state benchmark-state-${benchmark.status}`}
              >
                <span />
                {benchmarkStatus[benchmark.status]}
              </span>
              <span className={benchmark.simulated ? "tag tag-warn" : "tag tag-good"}>
                {benchmark.simulated ? "模拟数据" : "SOEM 实测"}
              </span>
              <span className="benchmark-clock">
                {benchmark.elapsedSec.toFixed(1)} / {benchmark.durationSec || benchmarkSeconds} s
              </span>
              <span className="benchmark-samples">
                {benchmark.samples.toLocaleString()} samples
              </span>
            </div>
            <div className="benchmark-grid">
              <div>
                <span>周期 p99</span>
                <strong>{benchmark.cycleTime.p99Us}</strong>
                <small>µs</small>
              </div>
              <div>
                <span>周期 p99.9</span>
                <strong>{benchmark.cycleTime.p999Us}</strong>
                <small>µs</small>
              </div>
              <div>
                <span>周期最大值</span>
                <strong>{benchmark.cycleTime.maxUs}</strong>
                <small>µs</small>
              </div>
              <div>
                <span>调度偏差 p99</span>
                <strong>{benchmark.scheduleJitter.p99Us}</strong>
                <small>µs</small>
              </div>
              <div>
                <span>收发耗时 p99</span>
                <strong>{benchmark.ioDuration.p99Us}</strong>
                <small>µs</small>
              </div>
            </div>
            <div className="benchmark-thresholds">
              <span>
                &gt; 1050 µs <strong>{benchmark.over1050.toLocaleString()}</strong>
              </span>
              <span>
                &gt; 1200 µs <strong>{benchmark.over1200.toLocaleString()}</strong>
              </span>
              <span>
                &gt; 2000 µs <strong>{benchmark.over2000.toLocaleString()}</strong>
              </span>
              <span>
                WKC 错误 <strong>{benchmark.wkcErrors.toLocaleString()}</strong>
              </span>
              <span>
                丢帧 <strong>{benchmark.lostFrames.toLocaleString()}</strong>
              </span>
            </div>
            {snapshot.mode !== "soem" ? (
              <div className="inline-notice neutral">
                <Timer size={16} />
                模拟核心只验证流程和界面；“模拟数据”不能作为 1 ms 实时性能证明。
              </div>
            ) : !benchmarkReady && !benchmarkRunning ? (
              <div className="inline-notice">
                <ShieldAlert size={16} />
                仅当总线进入 OP 后才能启动实时基准测试。
              </div>
            ) : null}
          </section>
        </div>

        <aside className="settings-aside">
          <section className="panel target-panel">
            <SectionHeader title="实时目标" />
            <div className="target-gauge">
              <span className="target-value">{draft.cycleUs / 1000}</span>
              <span className="target-unit">ms</span>
            </div>
            <span className="target-caption">Cyclic target</span>
            <div className="target-facts">
              <div>
                <Gauge size={16} />
                <span>
                  <strong>推荐抖动</strong>
                  <small>&lt; 100 µs</small>
                </span>
              </div>
              <div>
                <Cpu size={16} />
                <span>
                  <strong>隔离 CPU</strong>
                  <small>Core {draft.dedicatedCore}</small>
                </span>
              </div>
              <div>
                <Activity size={16} />
                <span>
                  <strong>调度策略</strong>
                  <small>{draft.realtimePriority ? "TIME_CRITICAL" : "NORMAL"}</small>
                </span>
              </div>
            </div>
          </section>

          <section className="panel compatibility-panel">
            <SectionHeader title="部署提示" />
            <ul className="plain-list">
              <li>使用独立 PCIe 或 USB 3.0 网卡，避免 Wi-Fi 与虚拟交换机。</li>
              <li>从 Windows 网卡属性中卸载 TCP/IPv4、IPv6 与 QoS 绑定。</li>
              <li>1 ms 属软实时目标，需以抖动、丢帧和 WKC 统计验收。</li>
              <li>不要在周期线程中执行 SDO、FoE、日志落盘或界面刷新。</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
