// 时间格式工具：HH:MM:SS <-> 秒

export function hms2s(h: string): number {
  const p = String(h).split(":").map(Number);
  if (p.length === 3) return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0);
  if (p.length === 2) return (p[0] || 0) * 60 + (p[1] || 0);
  return p[0] || 0;
}

export function s2hms(s: number): string {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return [h, m, x].map((v) => String(v).padStart(2, "0")).join(":");
}

/** 取文件路径的目录，用于后端 cwd */
export function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i <= 0 ? "" : path.slice(0, i);
}

/** 去掉扩展名 */
export function baseName(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const name = i >= 0 ? path.slice(i + 1) : path;
  return name.replace(/\.[^.]+$/, "");
}
