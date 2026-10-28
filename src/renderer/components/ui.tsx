import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type {
  LogLevel,
  MasterPhase,
  SlaveState,
  Snapshot
} from "../../shared/types";

export type ToastKind = "success" | "error" | "info" | "warning";
export type Notify = (kind: ToastKind, message: string) => void;

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  message: string;
}

export function PhaseBadge({ phase }: { phase: MasterPhase }) {
  const label: Record<MasterPhase, string> = {
    offline: "离线",
    connecting: "连接中",
    preop: "PRE-OP",
    safeop: "SAFE-OP",
    op: "OP",
    error: "故障"
  };
  return (
    <span className={`status-badge phase-${phase}`}>
      <span className="status-dot" />
      {label[phase]}
    </span>
  );
}

export function SlaveStateBadge({ state }: { state: SlaveState }) {
  return (
    <span className={`state-badge state-${state.toLowerCase().replace("-", "")}`}>
      {state}
    </span>
  );
}

export function LogIcon({ level }: { level: LogLevel }) {
  if (level === "success") {
    return <CircleCheck size={15} aria-hidden="true" />;
  }
  if (level === "warning") {
    return <TriangleAlert size={15} aria-hidden="true" />;
  }
  if (level === "error") {
    return <CircleAlert size={15} aria-hidden="true" />;
  }
  return <Info size={15} aria-hidden="true" />;
}

export function SectionHeader({
  title,
  detail,
  actions
}: {
  title: string;
  detail?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {detail ? <p>{detail}</p> : null}
      </div>
      {actions ? <div className="section-actions">{actions}</div> : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  actions
}: {
  eyebrow: string;
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Kpi({
  label,
  value,
  suffix,
  tone = "normal",
  hint
}: {
  label: string;
  value: string;
  suffix?: string;
  tone?: "normal" | "good" | "warning" | "error";
  hint?: string;
}) {
  return (
    <div className={`kpi kpi-${tone}`}>
      <span className="kpi-label">{label}</span>
      <div className="kpi-value">
        {value}
        {suffix ? <small>{suffix}</small> : null}
      </div>
      {hint ? <span className="kpi-hint">{hint}</span> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className = ""
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  detail
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  detail?: string;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span />
      </span>
    </label>
  );
}

export function EmptyState({
  icon,
  title,
  detail
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function ConnectionFacts({ snapshot }: { snapshot: Snapshot }) {
  const adapter =
    snapshot.adapters.find((item) => item.id === snapshot.selectedAdapterId) ??
    snapshot.adapters[0];
  return (
    <div className="connection-facts">
      <span>
        <strong>核心</strong>
        {snapshot.mode === "soem" ? "SOEM 实时核心" : "模拟核心"}
      </span>
      <span>
        <strong>网卡</strong>
        {adapter?.name ?? "未选择"}
      </span>
      <span>
        <strong>MAC</strong>
        {adapter?.mac ?? "--"}
      </span>
      <span>
        <strong>驱动</strong>
        {adapter?.driver ?? "--"}
      </span>
    </div>
  );
}

export function ToastHost({
  toast,
  onDismiss
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
}) {
  if (!toast) {
    return null;
  }
  const Icon =
    toast.kind === "success"
      ? CircleCheck
      : toast.kind === "warning"
        ? TriangleAlert
        : toast.kind === "error"
          ? CircleAlert
          : Info;
  return (
    <button className={`toast toast-${toast.kind}`} onClick={onDismiss}>
      <Icon size={17} />
      <span>{toast.message}</span>
    </button>
  );
}
