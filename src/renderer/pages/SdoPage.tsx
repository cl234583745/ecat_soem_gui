import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Clock3,
  Database,
  Eraser,
  Search
} from "lucide-react";
import { formatClock, formatHex, sanitizeHex } from "../../shared/format";
import type { SdoRequest, SdoResult, Snapshot } from "../../shared/types";
import { ecatBridge } from "../lib/bridge";
import {
  EmptyState,
  Field,
  PageHeader,
  SectionHeader,
  type Notify
} from "../components/ui";

const OBJECTS = [
  {
    label: "Statusword",
    index: "6041",
    subIndex: 0,
    type: "UINT16",
    group: "CiA 402"
  },
  {
    label: "Controlword",
    index: "6040",
    subIndex: 0,
    type: "UINT16",
    group: "CiA 402"
  },
  {
    label: "Position actual value",
    index: "6064",
    subIndex: 0,
    type: "INT32",
    group: "CiA 402"
  },
  {
    label: "Target position",
    index: "607A",
    subIndex: 0,
    type: "INT32",
    group: "CiA 402"
  },
  {
    label: "Torque actual value",
    index: "6077",
    subIndex: 0,
    type: "INT16",
    group: "CiA 402"
  },
  {
    label: "Vendor object 0x2000",
    index: "2000",
    subIndex: 0,
    type: "UINT32",
    group: "Manufacturer"
  }
];

interface HistoryItem {
  id: number;
  at: number;
  direction: "upload" | "download";
  slave: number;
  index: string;
  subIndex: number;
  value: string;
  elapsedUs: number;
  ok: boolean;
}

export function SdoPage({
  snapshot,
  notify
}: {
  snapshot: Snapshot;
  notify: Notify;
}) {
  const [slaveIndex, setSlaveIndex] = useState(
    snapshot.selectedSlaveIndex || snapshot.slaves[0]?.index || 1
  );
  const [index, setIndex] = useState("6041");
  const [subIndex, setSubIndex] = useState(0);
  const [dataType, setDataType] = useState("UINT16");
  const [valueHex, setValueHex] = useState("");
  const [completeAccess, setCompleteAccess] = useState(false);
  const [result, setResult] = useState<SdoResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const filteredObjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return OBJECTS;
    }
    return OBJECTS.filter(
      (object) =>
        object.label.toLowerCase().includes(normalized) ||
        object.index.includes(normalized)
    );
  }, [query]);

  function applyObject(object: (typeof OBJECTS)[number]) {
    setIndex(object.index);
    setSubIndex(object.subIndex);
    setDataType(object.type);
  }

  function request(): SdoRequest {
    return {
      slaveIndex,
      index,
      subIndex,
      dataType,
      valueHex: sanitizeHex(valueHex),
      completeAccess
    };
  }

  async function execute(direction: "upload" | "download") {
    setBusy(true);
    const payload = request();
    const response =
      direction === "upload"
        ? await ecatBridge.sdoRead(payload)
        : await ecatBridge.sdoWrite(payload);
    setBusy(false);
    notify(response.ok ? "success" : "error", response.message);
    if (!response.ok || !response.data) {
      return;
    }
    setResult(response.data);
    if (direction === "upload") {
      setValueHex(response.data.valueHex);
    }
    setHistory((current) => [
      {
        id: Date.now(),
        at: Date.now(),
        direction,
        slave: slaveIndex,
        index,
        subIndex,
        value: response.data!.valueHex,
        elapsedUs: response.data!.elapsedUs,
        ok: true
      },
      ...current
    ]);
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="SERVICE DATA OBJECT"
        title="SDO 对象访问"
        actions={
          <span className="header-hint">
            <Clock3 size={15} />
            Mailbox · CoE
          </span>
        }
      />

      <div className="sdo-layout">
        <aside className="panel object-browser">
          <SectionHeader title="对象字典" detail="常用对象与厂商对象" />
          <label className="search-box full">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索索引或名称"
            />
          </label>
          <div className="object-list">
            {filteredObjects.map((object) => (
              <button
                key={`${object.index}-${object.subIndex}`}
                className={
                  object.index === index && object.subIndex === subIndex
                    ? "object-item selected"
                    : "object-item"
                }
                onClick={() => applyObject(object)}
              >
                <span className="object-code">
                  {object.index}:{formatHex(object.subIndex, 2)}
                </span>
                <span>
                  <strong>{object.label}</strong>
                  <small>
                    {object.group} · {object.type}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div className="sdo-main">
          <section className="panel">
            <SectionHeader
              title="对象访问"
              detail="通过 CoE mailbox 上传或下载对象"
              actions={
                <select
                  value={slaveIndex}
                  onChange={(event) => setSlaveIndex(Number(event.target.value))}
                >
                  {snapshot.slaves.map((slave) => (
                    <option value={slave.index} key={slave.index}>
                      #{slave.index} {slave.name}
                    </option>
                  ))}
                </select>
              }
            />
            <div className="form-grid sdo-form-grid">
              <Field label="对象索引" hint="16-bit hexadecimal">
                <div className="input-prefix">
                  <span>0x</span>
                  <input
                    value={index}
                    maxLength={4}
                    onChange={(event) =>
                      setIndex(sanitizeHex(event.target.value).slice(0, 4))
                    }
                  />
                </div>
              </Field>
              <Field label="子索引" hint="0x00 - 0xFF">
                <div className="input-prefix">
                  <span>0x</span>
                  <input
                    value={formatHex(subIndex, 2)}
                    maxLength={2}
                    onChange={(event) =>
                      setSubIndex(
                        Number.parseInt(sanitizeHex(event.target.value) || "0", 16)
                      )
                    }
                  />
                </div>
              </Field>
              <Field label="数据类型">
                <select
                  value={dataType}
                  onChange={(event) => setDataType(event.target.value)}
                >
                  {[
                    "BOOLEAN",
                    "INT8",
                    "UINT8",
                    "INT16",
                    "UINT16",
                    "INT32",
                    "UINT32",
                    "INT64",
                    "UINT64",
                    "REAL32",
                    "VISIBLE_STRING",
                    "OCTET_STRING"
                  ].map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </Field>
              <Field label="Complete Access">
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={completeAccess}
                    onChange={(event) => setCompleteAccess(event.target.checked)}
                  />
                  读取完整对象
                </label>
              </Field>
            </div>

            <div className="hex-editor">
              <div className="hex-editor-head">
                <span>数据（十六进制）</span>
                <button
                  className="text-button"
                  onClick={() => setValueHex("")}
                  disabled={busy}
                >
                  <Eraser size={14} />
                  清除
                </button>
              </div>
              <textarea
                value={valueHex}
                onChange={(event) => setValueHex(sanitizeHex(event.target.value))}
                spellCheck={false}
                placeholder="00 00 00 00"
                rows={4}
              />
              <div className="hex-meta">
                <span>{valueHex.length / 2} bytes</span>
                <span>{valueHex.replace(/(.{2})/g, "$1 ").trim()}</span>
              </div>
            </div>

            <div className="button-row sdo-actions">
              <button
                className="button button-default grow"
                onClick={() => void execute("upload")}
                disabled={busy || !snapshot.connected}
              >
                <ArrowDownToLine size={16} />
                读取对象
              </button>
              <button
                className="button button-primary grow"
                onClick={() => void execute("download")}
                disabled={busy || !snapshot.connected || valueHex.length === 0}
              >
                <ArrowUpFromLine size={16} />
                写入对象
              </button>
            </div>
          </section>

          <section className="panel result-panel">
            <SectionHeader
              title="最近响应"
              actions={
                result ? (
                  <span className="tag tag-good">
                    {result.elapsedUs} µs
                  </span>
                ) : null
              }
            />
            {result ? (
              <div className="result-grid">
                <div>
                  <span>HEX</span>
                  <code>0x{result.valueHex}</code>
                </div>
                <div>
                  <span>DECIMAL</span>
                  <code>{result.valueDecimal}</code>
                </div>
                <div>
                  <span>LENGTH</span>
                  <code>{result.valueHex.length / 2} bytes</code>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Database size={21} />}
                title="等待对象响应"
                detail="读取或写入 SDO 后，结果将显示在这里。"
              />
            )}
          </section>
        </div>

        <aside className="panel sdo-history">
          <SectionHeader
            title="访问记录"
            actions={
              <button
                className="icon-button"
                onClick={() => setHistory([])}
                title="清空访问记录"
              >
                <Eraser size={15} />
              </button>
            }
          />
          {history.length === 0 ? (
            <EmptyState
              icon={<BookOpen size={21} />}
              title="暂无访问"
              detail="当前会话的 SDO 请求会显示在这里。"
            />
          ) : (
            <div className="sdo-history-list">
              {history.map((item) => (
                <div className="history-item" key={item.id}>
                  <span
                    className={
                      item.direction === "upload"
                        ? "history-direction upload"
                        : "history-direction download"
                    }
                  >
                    {item.direction === "upload" ? (
                      <ArrowDownToLine size={14} />
                    ) : (
                      <ArrowUpFromLine size={14} />
                    )}
                  </span>
                  <span>
                    <strong>
                      #{item.slave} · 0x{item.index}:{formatHex(item.subIndex, 2)}
                    </strong>
                    <small>
                      {formatClock(item.at)} · {item.elapsedUs} µs
                    </small>
                  </span>
                  <code>0x{item.value}</code>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
