import { Play, Radar, Square, Wifi, WifiOff } from "lucide-react";
import type { Snapshot } from "../../shared/types";
import { PhaseBadge } from "./ui";

export function Topbar({
  snapshot,
  title,
  busy,
  onToggleBus,
  onScan
}: {
  snapshot: Snapshot;
  title: string;
  busy: boolean;
  onToggleBus: () => void;
  onScan: () => void;
}) {
  const connected = snapshot.connected;
  return (
    <header className="topbar">
      <div className="topbar-title">
        <span>ECAT Bench</span>
        <strong>{title}</strong>
      </div>
      <div className="topbar-status">
        <span className={snapshot.mode === "soem" ? "core-chip live" : "core-chip"}>
          {snapshot.mode === "soem" ? "SOEM" : "SIM"}
        </span>
        <PhaseBadge phase={snapshot.phase} />
        <span className="topbar-adapter">
          {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
          {snapshot.adapters.find(
            (adapter) => adapter.id === snapshot.selectedAdapterId
          )?.name ?? "未选择网卡"}
        </span>
      </div>
      <div className="topbar-actions">
        <button className="button button-ghost" onClick={onScan} disabled={busy}>
          <Radar size={16} className={snapshot.scanning ? "spin" : ""} />
          {snapshot.scanning ? "扫描中" : "扫描从站"}
        </button>
        <button
          className={connected ? "button button-danger-subtle" : "button button-primary"}
          onClick={onToggleBus}
          disabled={busy || snapshot.phase === "connecting"}
        >
          {connected ? <Square size={15} /> : <Play size={15} />}
          {connected ? "停止总线" : "启动总线"}
        </button>
      </div>
    </header>
  );
}
