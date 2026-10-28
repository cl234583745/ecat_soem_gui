import {
  Activity,
  ArrowLeftRight,
  Database,
  LayoutDashboard,
  Mail,
  Network,
  SlidersHorizontal,
  UploadCloud,
  Workflow
} from "lucide-react";
import type { Snapshot } from "../../shared/types";
import { PhaseBadge } from "./ui";

export type PageId =
  | "overview"
  | "adapters"
  | "topology"
  | "states"
  | "sdo"
  | "pdo"
  | "mailbox"
  | "foe"
  | "settings";

const NAV_ITEMS = [
  { id: "overview" as const, label: "总线总览", icon: LayoutDashboard },
  { id: "adapters" as const, label: "网卡与周期", icon: Activity },
  { id: "topology" as const, label: "从站拓扑", icon: Network },
  { id: "states" as const, label: "状态机", icon: Workflow },
  { id: "sdo" as const, label: "SDO 对象", icon: Database },
  { id: "pdo" as const, label: "PDO 过程数据", icon: ArrowLeftRight },
  { id: "mailbox" as const, label: "邮箱诊断", icon: Mail },
  { id: "foe" as const, label: "FoE 固件", icon: UploadCloud },
  { id: "settings" as const, label: "工作区设置", icon: SlidersHorizontal }
];

export function Sidebar({
  activePage,
  onNavigate,
  snapshot
}: {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  snapshot: Snapshot;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="brand-copy">
          <strong>ECAT BENCH</strong>
          <span>Master Console</span>
        </div>
      </div>

      <nav className="nav" aria-label="主站功能">
        <span className="nav-label">工作区</span>
        {NAV_ITEMS.slice(0, 8).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={activePage === item.id ? "nav-item active" : "nav-item"}
              onClick={() => onNavigate(item.id)}
              title={item.label}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
            </button>
          );
        })}
        <span className="nav-label nav-label-secondary">系统</span>
        {NAV_ITEMS.slice(8).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={activePage === item.id ? "nav-item active" : "nav-item"}
              onClick={() => onNavigate(item.id)}
              title={item.label}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-status">
        <div className="sidebar-status-head">
          <span>{snapshot.mode === "soem" ? "SOEM 核心" : "模拟核心"}</span>
          <PhaseBadge phase={snapshot.phase} />
        </div>
        <div className="sidebar-adapter">
          <span className={snapshot.connected ? "link-led live" : "link-led"} />
          <div>
            <strong>
              {snapshot.adapters.find(
                (adapter) => adapter.id === snapshot.selectedAdapterId
              )?.name ?? "未选择网卡"}
            </strong>
            <small>
              {snapshot.slaves.length} 从站 · {snapshot.config.cycleUs / 1000} ms
            </small>
          </div>
        </div>
        <div className="sidebar-build">v{snapshot.version} · Windows x64</div>
      </div>
    </aside>
  );
}
