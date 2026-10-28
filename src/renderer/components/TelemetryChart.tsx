import type { TelemetryPoint } from "../../shared/types";

function linePath(
  points: TelemetryPoint[],
  getValue: (point: TelemetryPoint) => number,
  width: number,
  height: number,
  padding: number
): string {
  if (points.length === 0) {
    return "";
  }
  const values = points.map(getValue);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  return points
    .map((point, index) => {
      const x =
        padding + (index / Math.max(1, points.length - 1)) * (width - padding * 2);
      const y =
        height -
        padding -
        ((getValue(point) - min) / range) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function TelemetryChart({
  history,
  metric,
  color = "#087f75"
}: {
  history: TelemetryPoint[];
  metric: "cycleUs" | "jitterUs";
  color?: string;
}) {
  const width = 620;
  const height = 148;
  const padding = 12;
  const values = history.map((point) => point[metric]);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const latest = values.at(-1) ?? 0;
  const path = linePath(history, (point) => point[metric], width, height, padding);
  const area = path
    ? `${path} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`
    : "";

  return (
    <div className="chart">
      <div className="chart-axis">
        <span>{max.toLocaleString()} µs</span>
        <span>{min.toLocaleString()} µs</span>
      </div>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${metric === "cycleUs" ? "周期时间" : "周期抖动"}趋势，当前 ${latest} 微秒`}
      >
        <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} />
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
        />
        {area ? <path d={area} fill={color} opacity="0.08" /> : null}
        {path ? <path d={path} fill="none" stroke={color} strokeWidth="2" /> : null}
      </svg>
      <div className="chart-caption">
        <span>最近 {history.length} 个采样点</span>
        <strong>
          {latest.toLocaleString()} µs
        </strong>
      </div>
    </div>
  );
}
