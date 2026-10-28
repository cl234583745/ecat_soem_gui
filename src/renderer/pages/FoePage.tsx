import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileArchive,
  FileUp,
  LockKeyhole,
  RefreshCw,
  Square,
  UploadCloud
} from "lucide-react";
import { formatBytes } from "../../shared/format";
import type { FoeFileInfo, Snapshot } from "../../shared/types";
import { ecatBridge, isDesktop } from "../lib/bridge";
import {
  Field,
  PageHeader,
  SectionHeader,
  type Notify
} from "../components/ui";

export function FoePage({
  snapshot,
  notify
}: {
  snapshot: Snapshot;
  notify: Notify;
}) {
  const [direction, setDirection] = useState<"download" | "upload">("download");
  const [file, setFile] = useState<FoeFileInfo | null>(null);
  const [password, setPassword] = useState("");
  const [slaveIndex, setSlaveIndex] = useState(
    snapshot.selectedSlaveIndex || snapshot.slaves[0]?.index || 1
  );
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function chooseFile() {
    if (isDesktop) {
      const selected = await ecatBridge.pickFirmware(direction);
      if (selected) {
        setFile(selected);
      }
      return;
    }
    inputRef.current?.click();
  }

  function onBrowserFile(selected: File | undefined) {
    if (!selected) {
      return;
    }
    setFile({
      name: selected.name,
      path: selected.name,
      size: selected.size
    });
  }

  async function start() {
    if (!file) {
      notify("warning", "请先选择固件文件");
      return;
    }
    setBusy(true);
    if (snapshot.selectedSlaveIndex !== slaveIndex) {
      const selected = await ecatBridge.selectSlave(slaveIndex);
      if (!selected.ok) {
        notify("error", selected.message);
        setBusy(false);
        return;
      }
    }
    const result = await ecatBridge.startFoe(direction, file, password);
    notify(result.ok ? "success" : "error", result.message);
    setBusy(false);
  }

  function changeDirection(next: "download" | "upload") {
    setDirection(next);
    setFile(null);
  }

  const progress = snapshot.transfer.progress;
  const progressAvailable = snapshot.transfer.progressAvailable;
  const showProgress = !snapshot.transfer.active || progressAvailable;
  return (
    <div className="page">
      <PageHeader
        eyebrow="FIRMWARE OVER ETHERCAT"
        title="FoE 固件升级"
        actions={
          <span className={snapshot.transfer.active ? "live-chip" : "live-chip idle"}>
            <UploadCloud size={15} />
            {snapshot.transfer.active ? "传输中" : "等待任务"}
          </span>
        }
      />

      <div className="foe-layout">
        <div className="foe-main">
          <section className="panel">
            <SectionHeader
              title="固件任务"
              detail="FoE 使用从站邮箱传输文件，任务执行期间不应停止主站。"
              actions={
                <select
                  value={slaveIndex}
                  onChange={(event) => setSlaveIndex(Number(event.target.value))}
                >
                  {snapshot.slaves.map((slave) => (
                    <option key={slave.index} value={slave.index}>
                      #{slave.index} {slave.name}
                    </option>
                  ))}
                </select>
              }
            />

            <div className="direction-switch">
              <button
                className={direction === "download" ? "active" : ""}
                onClick={() => changeDirection("download")}
              >
                <UploadCloud size={19} />
                <span>
                  <strong>下载到从站</strong>
                  <small>Upload firmware to slave</small>
                </span>
              </button>
              <button
                className={direction === "upload" ? "active" : ""}
                onClick={() => changeDirection("upload")}
              >
                <FileUp size={19} />
                <span>
                  <strong>从从站读取</strong>
                  <small>Read firmware from slave</small>
                </span>
              </button>
            </div>

            <button className="file-drop" onClick={() => void chooseFile()}>
              <input
                ref={inputRef}
                type="file"
                hidden
                accept=".bin,.efw,.img,.hex"
                onChange={(event) => onBrowserFile(event.target.files?.[0])}
              />
              <span className="file-drop-icon">
                {file ? <FileArchive size={23} /> : <UploadCloud size={23} />}
              </span>
              <span>
                <strong>
                  {file?.name ??
                    (direction === "download"
                      ? "选择待写入固件"
                      : "选择上传保存位置")}
                </strong>
                <small>
                  {file
                    ? `${direction === "upload" ? "目标" : formatBytes(file.size)} · ${file.path}`
                    : "支持 .bin / .efw / .img / .hex"}
                </small>
              </span>
              <span className="button button-ghost">浏览</span>
            </button>

            <div className="form-grid foe-form">
              <Field label="目标从站">
                <select
                  value={slaveIndex}
                  onChange={(event) => setSlaveIndex(Number(event.target.value))}
                >
                  {snapshot.slaves.map((slave) => (
                    <option key={slave.index} value={slave.index}>
                      #{slave.index} {slave.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="FoE 密码"
                hint="从站未启用密码时留空"
              >
                <div className="input-icon">
                  <LockKeyhole size={15} />
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Optional password"
                  />
                </div>
              </Field>
            </div>
          </section>

          <section className="panel transfer-panel">
            <SectionHeader
              title="传输状态"
              actions={
                <span
                  className={
                    snapshot.transfer.status === "success"
                      ? "tag tag-good"
                      : snapshot.transfer.status === "error"
                        ? "tag tag-error"
                        : "tag"
                  }
                >
                  {snapshot.transfer.status.toUpperCase()}
                </span>
              }
            />
            <div className="transfer-head">
              <div>
                <strong>{snapshot.transfer.fileName || file?.name || "尚未开始"}</strong>
                <span>{snapshot.transfer.message}</span>
              </div>
              <strong className="transfer-percent">
                {snapshot.transfer.active && !progressAvailable
                  ? "运行中"
                  : `${progress}%`}
              </strong>
            </div>
            <div className="progress-track">
              <span
                className={
                  snapshot.transfer.active && !progressAvailable
                    ? "indeterminate"
                    : ""
                }
                style={showProgress ? { width: `${progress}%` } : undefined}
              />
            </div>
            <div className="transfer-meta">
              <span>
                {snapshot.transfer.active && !progressAvailable
                  ? `已接收 ${formatBytes(snapshot.transfer.bytesCompleted)}`
                  : `${formatBytes(snapshot.transfer.bytesCompleted)} / ${
                      snapshot.transfer.bytesTotal > 0
                        ? formatBytes(snapshot.transfer.bytesTotal)
                        : "未知"
                    }`}
              </span>
              <span>{direction === "download" ? "FoE Write" : "FoE Read"}</span>
            </div>
            <div className="button-row">
              {snapshot.transfer.active ? (
                <button
                  className="button button-danger-subtle"
                  disabled
                  title="SOEM 阻塞式 FoE API 不支持安全取消"
                >
                  <Square size={14} />
                  SOEM 不支持取消
                </button>
              ) : (
                <button
                  className="button button-primary"
                  onClick={() => void start()}
                  disabled={busy || !snapshot.connected}
                >
                  <RefreshCw size={16} className={busy ? "spin" : ""} />
                  {busy ? "正在启动" : "开始传输"}
                </button>
              )}
            </div>
          </section>
        </div>

        <aside className="foe-aside">
          <section className="panel file-facts">
            <SectionHeader title="文件信息" />
            <dl className="detail-list">
              <div>
                <dt>文件名</dt>
                <dd>{file?.name ?? "--"}</dd>
              </div>
              <div>
                <dt>文件大小</dt>
                <dd>
                  {!file
                    ? "--"
                    : direction === "upload"
                      ? "由从站返回"
                      : formatBytes(file.size)}
                </dd>
              </div>
              <div>
                <dt>传输方向</dt>
                <dd>{direction === "download" ? "Master → Slave" : "Slave → Master"}</dd>
              </div>
              <div>
                <dt>邮箱协议</dt>
                <dd>FoE</dd>
              </div>
              <div>
                <dt>CRC 校验</dt>
                <dd>未实现，需从站或上层校验</dd>
              </div>
            </dl>
          </section>

          <section className="panel note-panel warning">
            <span className="note-icon">
              <AlertTriangle size={18} />
            </span>
            <div>
              <strong>升级期间保持链路稳定</strong>
              <p>断电或中断邮箱传输可能导致从站停留在 Bootloader。</p>
            </div>
          </section>

          <section className="panel note-panel success">
            <span className="note-icon">
              <CheckCircle2 size={18} />
            </span>
            <div>
              <strong>传输后验证</strong>
              <p>建议重新扫描并读取 Vendor ID、Revision 与序列号。</p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
