export function formatHex(value: number, width = 4): string {
  return value.toString(16).toUpperCase().padStart(width, "0");
}

export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatClock(at: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(at);
}

export function sanitizeHex(value: string): string {
  return value
    .replace(/0x/gi, "")
    .replace(/[^0-9a-f]/gi, "")
    .toUpperCase();
}
