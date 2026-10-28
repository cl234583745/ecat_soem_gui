import { useEffect, useState } from "react";
import {
  ArrowRight,
  Braces,
  Copy,
  Mail,
  RotateCcw,
  Send,
  Trash2
} from "lucide-react";
import { formatClock, sanitizeHex } from "../../shared/format";
import type {
  MailboxRequest,
  MailboxResult,
  Snapshot
} from "../../shared/types";
import { ecatBridge } from "../lib/bridge";
import {
  EmptyState,
  Field,
  PageHeader,
  SectionHeader,
  type Notify
} from "../components/ui";

interface MailboxTrace {
  id: number;
  at: number;
  protocol: MailboxRequest["protocol"];
  slave: number;
  request: string;
  response: string;
  elapsedUs: number;
  ok: boolean;
}

export function MailboxPage({
  snapshot,
  notify
}: {
  snapshot: Snapshot;
  notify: Notify;
}) {
  const [slaveIndex, setSlaveIndex] = useState(
    snapshot.selectedSlaveIndex || snapshot.slaves[0]?.index || 1
  );
  const [protocol, setProtocol] =
    useState<MailboxRequest["protocol"]>("CoE");
  const [payload, setPayload] = useState("01 00 00 00 00 00 00 00");
  const [result, setResult] = useState<MailboxResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [trace, setTrace] = useState<MailboxTrace[]>([
    {
      id: 1,
      at: Date.now() - 52_000,
      protocol: "CoE",
      slave: 1,
      request: "40 41 60 00 00 00 00 00",
      response: "4B 41 60 00 37 02 00 00",
      elapsedUs: 382,
      ok: true
    },
    {
      id: 2,
      at: Date.now() - 41_000,
      protocol: "CoE",
      slave: 2,
      request: "40 00 60 01 00 00 00 00",
      response: "4F 00 60 01 A5 00 00 00",
      elapsedUs: 314,
      ok: true
    }
  ]);
  const traceLimit = Math.max(0, snapshot.config.retainFrames);

  useEffect(() => {
    setTrace((current) => current.slice(0, traceLimit));
  }, [traceLimit]);

  async function send() {
    setBusy(true);
    const request: MailboxRequest = {
      slaveIndex,
      protocol,
      payloadHex: sanitizeHex(payload)
    };
    const response = await ecatBridge.sendMailbox(request);
    setBusy(false);
    notify(response.ok ? "success" : "error", response.message);
    if (response.ok && response.data) {
      setResult(response.data);
    }
    setTrace((current) =>
      [
        {
          id: Date.now(),
          at: Date.now(),
          protocol,
          slave: slaveIndex,
          request: payload,
          response: response.data?.responseHex ?? "--",
          elapsedUs: response.data?.elapsedUs ?? 0,
          ok: response.ok
        },
        ...current
      ].slice(0, traceLimit)
    );
  }

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
    notify("success", "已复制到剪贴板");
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="MAILBOX DIAGNOSTICS"
        title="邮箱诊断"
        actions={
          <span className="header-hint">
            <Mail size={15} />
            Raw mailbox
          </span>
        }
      />

      <div className="mailbox-layout">
        <div className="mailbox-main">
          <section className="panel">
            <SectionHeader
              title="原始邮箱请求"
              detail="直接发送 EtherCAT mailbox payload，不含 Ethernet / EtherCAT 帧头。"
            />
            <div className="mailbox-toolbar">
              <div className="segmented">
                {(["CoE", "EoE", "FoE", "AoE"] as const).map((item) => (
                  <button
                    key={item}
                    className={protocol === item ? "active" : ""}
                    onClick={() => setProtocol(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
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
            </div>
            <div className="mailbox-editor-grid">
              <div className="mailbox-editor">
                <div className="hex-editor-head">
                  <span>TX payload</span>
                  <span className="mono muted">{payload.length / 3} bytes</span>
                </div>
                <textarea
                  rows={7}
                  value={payload}
                  onChange={(event) =>
                    setPayload(
                      event.target.value
                        .toUpperCase()
                        .replace(/[^0-9A-F\s]/g, "")
                    )
                  }
                  spellCheck={false}
                />
                <div className="byte-ruler">
                  {Array.from({ length: 8 }, (_, index) => (
                    <span key={index}>{index.toString(16).padStart(2, "0")}</span>
                  ))}
                </div>
              </div>
              <div className="mailbox-response">
                <div className="hex-editor-head">
                  <span>RX payload</span>
                  {result ? (
                    <button
                      className="icon-button"
                      title="复制响应"
                      onClick={() => void copyText(result.responseHex)}
                    >
                      <Copy size={14} />
                    </button>
                  ) : null}
                </div>
                {result ? (
                  <code className="response-bytes">
                    {result.responseHex
                      .replace(/(.{2})/g, "$1 ")
                      .trim()}
                  </code>
                ) : (
                  <EmptyState
                    icon={<Braces size={20} />}
                    title="等待邮箱响应"
                    detail="发送请求后显示返回 payload。"
                  />
                )}
                <span className="response-time">
                  {result ? `${result.elapsedUs} µs` : "-- µs"}
                </span>
              </div>
            </div>
            <div className="button-row">
              <button
                className="button button-primary"
                onClick={() => void send()}
                disabled={
                  busy ||
                  !snapshot.connected ||
                  sanitizeHex(payload).length === 0
                }
              >
                <Send size={16} />
                {busy ? "等待响应" : "发送请求"}
              </button>
              <button
                className="button button-ghost"
                onClick={() => setPayload("")}
              >
                <RotateCcw size={15} />
                清空
              </button>
            </div>
          </section>

          <section className="panel trace-panel">
            <SectionHeader
              title="邮箱事务"
              detail={`${trace.length} / ${traceLimit} 条当前会话记录`}
              actions={
                <button
                  className="text-button"
                  onClick={() => setTrace([])}
                >
                  <Trash2 size={14} />
                  清空
                </button>
              }
            />
            {trace.length === 0 ? (
              <EmptyState
                icon={<Mail size={21} />}
                title="暂无邮箱事务"
                detail="发送的请求和响应会记录在这里。"
              />
            ) : (
              <div className="trace-list">
                {trace.map((item) => (
                  <div className="trace-row" key={item.id}>
                    <span className="trace-time mono">{formatClock(item.at)}</span>
                    <span className="protocol-tag">{item.protocol}</span>
                    <span className="trace-slave">#{item.slave}</span>
                    <code title={item.request}>
                      {item.request.replace(/\s/g, "").slice(0, 16) || "--"}
                    </code>
                    <ArrowRight size={14} />
                    <code title={item.response}>
                      {item.response.replace(/\s/g, "").slice(0, 16) || "--"}
                    </code>
                    <span
                      className={item.ok ? "trace-result success" : "trace-result error"}
                    >
                      {item.ok ? `${item.elapsedUs} µs` : "ERROR"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="mailbox-aside">
          <section className="panel">
            <SectionHeader title="邮箱参数" />
            <dl className="detail-list">
              <div>
                <dt>从站</dt>
                <dd>#{slaveIndex}</dd>
              </div>
              <div>
                <dt>协议</dt>
                <dd>{protocol}</dd>
              </div>
              <div>
                <dt>发送超时</dt>
                <dd>{snapshot.config.sendTimeoutUs} µs</dd>
              </div>
              <div>
                <dt>接收超时</dt>
                <dd>{snapshot.config.receiveTimeoutUs} µs</dd>
              </div>
              <div>
                <dt>邮箱错误</dt>
                <dd>{snapshot.counters.mailboxErrors}</dd>
              </div>
            </dl>
          </section>

          <section className="panel protocol-help">
            <SectionHeader title="协议入口" />
            <div className="protocol-entry">
              <strong>CoE</strong>
              <span>SDO / PDO assignment / object dictionary</span>
            </div>
            <div className="protocol-entry">
              <strong>EoE</strong>
              <span>Ethernet over EtherCAT 邮箱隧道</span>
            </div>
            <div className="protocol-entry">
              <strong>FoE</strong>
              <span>Firmware over EtherCAT 固件传输</span>
            </div>
            <div className="protocol-entry">
              <strong>AoE</strong>
              <span>ADS over EtherCAT 网关访问</span>
            </div>
          </section>

          <section className="panel byte-order-panel">
            <Field label="数据校验">
              <div className="check-line muted">
                <input type="checkbox" checked readOnly />
                自动把输入整理为十六进制字节
              </div>
            </Field>
          </section>
        </aside>
      </div>
    </div>
  );
}
