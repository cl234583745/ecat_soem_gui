import { useCallback, useEffect, useState } from "react";
import { ecatBridge } from "./lib/bridge";
import { useEcat } from "./hooks/useEcat";
import { Sidebar, type PageId } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import {
  ToastHost,
  type ToastKind,
  type ToastMessage
} from "./components/ui";
import { OverviewPage } from "./pages/OverviewPage";
import { AdaptersPage } from "./pages/AdaptersPage";
import { TopologyPage } from "./pages/TopologyPage";
import { StateMachinePage } from "./pages/StateMachinePage";
import { SdoPage } from "./pages/SdoPage";
import { PdoPage } from "./pages/PdoPage";
import { MailboxPage } from "./pages/MailboxPage";
import { FoePage } from "./pages/FoePage";
import { SettingsPage } from "./pages/SettingsPage";

const PAGE_TITLES: Record<PageId, string> = {
  overview: "总线总览",
  adapters: "网卡与周期",
  topology: "从站拓扑",
  states: "状态机",
  sdo: "SDO 对象",
  pdo: "PDO 过程数据",
  mailbox: "邮箱诊断",
  foe: "FoE 固件",
  settings: "工作区设置"
};

export default function App() {
  const { snapshot } = useEcat();
  const [activePage, setActivePage] = useState<PageId>("overview");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [busy, setBusy] = useState(false);

  const notify = useCallback((kind: ToastKind, message: string) => {
    setToast({ id: Date.now(), kind, message });
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F5") {
        event.preventDefault();
        void ecatBridge.scan().then((result) => {
          notify(result.ok ? "success" : "error", result.message);
        });
      }
      if (event.key === "Enter" && event.ctrlKey && snapshot) {
        event.preventDefault();
        setBusy(true);
        const action = snapshot.connected
          ? ecatBridge.disconnect()
          : ecatBridge.connect(snapshot.selectedAdapterId);
        void action.then((result) => {
          notify(result.ok ? "success" : "error", result.message);
          setBusy(false);
        });
      }
      if (event.key === "Escape") {
        setToast(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [notify, snapshot]);

  if (!snapshot) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">
          <span />
          <span />
          <span />
        </div>
        <strong>ECAT BENCH</strong>
        <span>Initializing master console</span>
      </div>
    );
  }

  const liveSnapshot = snapshot;

  async function toggleBus() {
    setBusy(true);
    const result = liveSnapshot.connected
      ? await ecatBridge.disconnect()
      : await ecatBridge.connect(liveSnapshot.selectedAdapterId);
    notify(result.ok ? "success" : "error", result.message);
    setBusy(false);
  }

  async function scan() {
    setBusy(true);
    const result = await ecatBridge.scan();
    notify(result.ok ? "success" : "error", result.message);
    setBusy(false);
  }

  function renderPage() {
    const common = { snapshot: liveSnapshot, notify };
    switch (activePage) {
      case "adapters":
        return <AdaptersPage {...common} />;
      case "topology":
        return <TopologyPage {...common} />;
      case "states":
        return <StateMachinePage {...common} />;
      case "sdo":
        return <SdoPage {...common} />;
      case "pdo":
        return <PdoPage {...common} />;
      case "mailbox":
        return <MailboxPage {...common} />;
      case "foe":
        return <FoePage {...common} />;
      case "settings":
        return <SettingsPage {...common} />;
      case "overview":
      default:
        return <OverviewPage {...common} />;
    }
  }

  return (
    <div className="app-shell">
      <Sidebar
        activePage={activePage}
        onNavigate={setActivePage}
        snapshot={liveSnapshot}
      />
      <div className="workspace">
        <Topbar
          snapshot={liveSnapshot}
          title={PAGE_TITLES[activePage]}
          busy={busy}
          onToggleBus={() => void toggleBus()}
          onScan={() => void scan()}
        />
        <main className="content">{renderPage()}</main>
        <footer className="statusbar">
          <span className={liveSnapshot.connected ? "statusbar-led live" : "statusbar-led"} />
          <span>{liveSnapshot.mode === "soem" ? "SOEM core" : "Simulator core"}</span>
          <span className="statusbar-sep" />
          <span>Cycle {liveSnapshot.config.cycleUs} µs</span>
          <span className="statusbar-sep" />
          <span>WKC {liveSnapshot.telemetry.wkc}/{liveSnapshot.telemetry.expectedWkc}</span>
          <span className="statusbar-sep" />
          <span>Lost {liveSnapshot.counters.lostFrames}</span>
          <span className="statusbar-spacer" />
          <span>{liveSnapshot.counters.cycles.toLocaleString()} cycles</span>
          <span className="statusbar-sep" />
          <span>v{liveSnapshot.version}</span>
        </footer>
      </div>
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
