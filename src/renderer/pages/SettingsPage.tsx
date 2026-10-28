import { useEffect, useState } from "react";
import {
  Braces,
  CheckCircle2,
  Cpu,
  Download,
  FileCode2,
  FolderCog,
  HardDrive,
  Info,
  Save,
  ShieldCheck,
  SlidersHorizontal
} from "lucide-react";
import type { MasterConfig, Snapshot } from "../../shared/types";
import { ecatBridge, isDesktop } from "../lib/bridge";
import {
  Field,
  PageHeader,
  SectionHeader,
  Toggle,
  type Notify
} from "../components/ui";

export function SettingsPage({
  snapshot,
  notify
}: {
  snapshot: Snapshot;
  notify: Notify;
}) {
  const [draft, setDraft] = useState(snapshot.config);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(snapshot.config);
  }, [snapshot.config]);

  function set<K extends keyof MasterConfig>(key: K, value: MasterConfig[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
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

  function exportWorkspace() {
    const content = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        application: "ECAT Bench",
        version: snapshot.version,
        config: snapshot.config,
        counters: snapshot.counters,
        slaves: snapshot.slaves,
        logs: snapshot.logs
      },
      null,
      2
    );
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ecat-bench-workspace.json";
    anchor.click();
    URL.revokeObjectURL(url);
    notify("success", "工作区诊断已导出");
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="WORKSPACE SETTINGS"
        title="工作区设置"
        actions={
          <button className="button button-primary" onClick={() => void save()} disabled={saving}>
            <Save size={16} />
            {saving ? "保存中" : "保存设置"}
          </button>
        }
      />

      <div className="settings-layout">
        <div className="settings-main">
          <section className="panel">
            <SectionHeader
              title="核心与运行环境"
              detail="GUI 与实时主站核心独立进程运行，界面刷新不会进入周期线程。"
            />
            <div className="runtime-grid">
              <div>
                <span className="runtime-icon">
                  <Cpu size={19} />
                </span>
                <span>
                  <small>核心模式</small>
                  <strong>
                    {snapshot.mode === "soem" ? "SOEM 实时核心" : "内置模拟核心"}
                  </strong>
                </span>
              </div>
              <div>
                <span className="runtime-icon">
                  <Braces size={19} />
                </span>
                <span>
                  <small>桌面运行时</small>
                  <strong>{isDesktop ? "Electron · Windows" : "Browser Preview"}</strong>
                </span>
              </div>
              <div>
                <span className="runtime-icon">
                  <ShieldCheck size={19} />
                </span>
                <span>
                  <small>进程隔离</small>
                  <strong>Renderer / IPC / Core</strong>
                </span>
              </div>
            </div>
            {!snapshot.capabilities.hardware ? (
              <div className="inline-notice neutral">
                <Info size={16} />
                当前使用模拟核心。真实 SOEM 核心需要编译原生组件并安装 NPCAP。
              </div>
            ) : null}
          </section>

          <section className="panel">
            <SectionHeader
              title="诊断与记录"
              detail="控制会话日志、报文保留和诊断数据规模。"
            />
            <div className="toggle-grid settings-toggles">
              <Toggle
                checked={draft.logToDisk}
                onChange={(value) => set("logToDisk", value)}
                label="会话日志落盘"
                detail="在应用用户数据目录持续写入 JSONL 会话日志"
              />
              <Toggle
                checked={draft.realtimePriority}
                onChange={(value) => set("realtimePriority", value)}
                label="实时线程优先级"
                detail="真实核心启动时应用 TIME_CRITICAL"
              />
            </div>
            <div className="form-grid settings-fields">
              <Field
                label="邮箱事务保留"
                hint="限制当前会话的邮箱事务列表；不缓存原始以太网帧"
              >
                <div className="input-unit">
                  <input
                    type="number"
                    min={100}
                    max={100000}
                    step={100}
                    value={draft.retainFrames}
                    onChange={(event) =>
                      set("retainFrames", Number(event.target.value))
                    }
                  />
                  <span>帧</span>
                </div>
              </Field>
              <Field label="实时核绑核" hint="0 表示不绑定 CPU">
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
          </section>

          <section className="panel">
            <SectionHeader
              title="配置工作区"
              detail="ENI 文件提供固定拓扑与 PDO 映射，可随诊断包一起导出。"
              actions={
                <button className="button button-default" onClick={() => void loadEni()}>
                  <FileCode2 size={15} />
                  导入 ENI
                </button>
              }
            />
            <div className="workspace-config">
              <span className="workspace-file-icon">
                <FolderCog size={21} />
              </span>
              <div>
                <strong>{draft.eniPath || "未绑定 ENI 配置"}</strong>
                <small>
                  {draft.eniPath
                    ? "已登记路径；过程数据仍由 SOEM 自动映射"
                    : "使用扫描结果和 SOEM 自动映射"}
                </small>
              </div>
              <button
                className="button button-ghost"
                onClick={() => {
                  set("eniPath", "");
                  notify("info", "ENI 绑定将在保存后移除");
                }}
              >
                移除
              </button>
            </div>
          </section>

          <section className="panel">
            <SectionHeader title="诊断导出" />
            <div className="export-row">
              <span className="export-icon">
                <HardDrive size={20} />
              </span>
              <div>
                <strong>工作区诊断包</strong>
                <small>配置、从站身份、计数器与会话事件</small>
              </div>
              <button className="button button-default" onClick={exportWorkspace}>
                <Download size={15} />
                导出 JSON
              </button>
            </div>
          </section>
        </div>

        <aside className="settings-aside">
          <section className="panel about-panel">
            <span className="about-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <h2>ECAT Bench</h2>
            <p>Compact EtherCAT master commissioning console.</p>
            <dl className="detail-list">
              <div>
                <dt>Version</dt>
                <dd>{snapshot.version}</dd>
              </div>
              <div>
                <dt>Protocol</dt>
                <dd>EtherCAT / CoE / FoE</dd>
              </div>
              <div>
                <dt>Core</dt>
                <dd>SOEM compatible</dd>
              </div>
              <div>
                <dt>Target</dt>
                <dd>Windows 10 / 11 x64</dd>
              </div>
            </dl>
            <div className="about-ok">
              <CheckCircle2 size={16} />
              <span>本地运行，不上传设备数据</span>
            </div>
          </section>

          <section className="panel architecture-card">
            <SectionHeader title="进程边界" />
            <div className="architecture-flow">
              <span>React UI</span>
              <i />
              <span>IPC Bridge</span>
              <i />
              <span>SOEM Core</span>
            </div>
            <ul className="plain-list">
              <li>UI 采样的事件流与遥测最多 20 Hz。</li>
              <li>周期线程不做内存分配、阻塞 IO 或日志格式化。</li>
              <li>SDO、FoE 等邮箱任务通过命令队列串行化。</li>
            </ul>
          </section>

          <section className="panel shortcut-panel">
            <SectionHeader title="快捷键" />
            <div>
              <span>扫描从站</span>
              <kbd>F5</kbd>
            </div>
            <div>
              <span>启动 / 停止总线</span>
              <kbd>Ctrl</kbd>
              <kbd>Enter</kbd>
            </div>
            <div>
              <span>清空当前视图</span>
              <kbd>Esc</kbd>
            </div>
          </section>

          <section className="panel legal-panel">
            <SlidersHorizontal size={17} />
            <p>
              SOEM 采用其上游许可证。发布安装包时需一并包含第三方许可证与
              NPCAP 安装说明。
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
