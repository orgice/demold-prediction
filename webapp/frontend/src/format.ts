// 서버는 타임존 없는 현장 현지시각(KST)을 주고받는다. 브라우저 타임존 변환 없이 문자열로 다룬다.

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [d, t = ""] = iso.split("T");
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)} ${t.slice(0, 5)}`;
}

export function fmtFull(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 16);
}

export function fmtAge(hours: number | null | undefined): string {
  if (hours == null) return "—";
  if (hours < 48) return `${hours.toFixed(0)}시간`;
  return `${(hours / 24).toFixed(1)}일`;
}

/** <input type="datetime-local"> 값 <-> 서버 ISO */
export const toInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 16) : "");
export const fromInput = (v: string) => (v ? `${v}:00` : null);

export function addHours(iso: string, h: number): string {
  const d = new Date(`${iso.slice(0, 19)}Z`);
  d.setTime(d.getTime() + h * 3600_000);
  return d.toISOString().slice(0, 19);
}

export function hoursBetween(a: string, b: string): number {
  return (new Date(`${b.slice(0, 19)}Z`).getTime() - new Date(`${a.slice(0, 19)}Z`).getTime()) / 3600_000;
}
