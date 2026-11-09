// 날짜·시각을 화면용 글자로 바꾸는 함수들.
// 서버는 타임존 없는 현장 현지시각(KST)을 주고받는다. 브라우저 타임존 변환 없이 문자열로 다룬다.
// 시각 문자열 예: "2026-03-16T14:14:00"

/** "2026-03-16T14:14:00" → "3/16 14:14" (짧게) */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [d, t = ""] = iso.split("T");
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)} ${t.slice(0, 5)}`;
}

/** "2026-03-16T14:14:00" → "2026-03-16 14:14" */
export function fmtFull(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 16);
}

/** 경과 시간: 48시간 미만은 "28시간", 그 이상은 "4.9일" */
export function fmtAge(hours: number | null | undefined): string {
  if (hours == null) return "—";
  if (hours < 48) return `${hours.toFixed(0)}시간`;
  return `${(hours / 24).toFixed(1)}일`;
}

/** <input type="datetime-local"> 값 <-> 서버 ISO */
export const toInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 16) : "");
export const fromInput = (v: string) => (v ? `${v}:00` : null);

/** 시각 문자열에 h시간을 더한다 (음수면 뺀다). 타임존이 끼지 않게 UTC로 계산 */
export function addHours(iso: string, h: number): string {
  const d = new Date(`${iso.slice(0, 19)}Z`);
  d.setTime(d.getTime() + h * 3600_000);
  return d.toISOString().slice(0, 19);
}

/** 두 시각 사이가 몇 시간인지 (b − a) */
export function hoursBetween(a: string, b: string): number {
  return (new Date(`${b.slice(0, 19)}Z`).getTime() - new Date(`${a.slice(0, 19)}Z`).getTime()) / 3600_000;
}
