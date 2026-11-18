// 사용자가 고른 그래프 선 색 (내 계정 › 그래프 색 설정, components/GraphColorSettings.tsx).
// 계정 정보는 아직 백엔드 미연동 목업이므로 색은 이 브라우저(localStorage)에만 저장한다.
// 저장이 막힌 브라우저(사생활 보호 모드 등)에서는 기본색으로 동작하고, 바꾼 색은 새로고침하면 사라진다.
import { useSyncExternalStore } from "react";

export type LineKey =
  | "observed" | "forecast" | "initial"            // 압축강도 그래프
  | "target5" | "target14" | "targetDesign"        // 목표 강도선
  | "tempObserved" | "tempAssumed";                // 내부온도 그래프

export type LineColors = Record<LineKey, string>;

/** 기본색 = 지금까지 쓰던 색 (DESIGN.md 7장) */
export const DEFAULT_LINE_COLORS: LineColors = {
  observed: "#1D5BD6",
  forecast: "#E07A00",
  initial: "#8892A0",
  target5: "#6941C6",
  target14: "#6941C6",
  targetDesign: "#6941C6",
  tempObserved: "#1D5BD6",
  tempAssumed: "#546070",
};

/** 설정 화면에서 바로 고를 수 있는 색 (흰 바탕에서 구분되는 중간 채도) */
export const COLOR_PRESETS = [
  "#1D5BD6", "#0B8BC7", "#0E9384", "#19804D", "#6E8B1E", "#E07A00",
  "#B42318", "#C23B7A", "#6941C6", "#475467", "#8892A0", "#18202C",
];

const STORAGE_KEY = "formcast.lineColors.v1";
const HEX = /^#[0-9a-f]{6}$/i;

function load(): LineColors {
  const out = { ...DEFAULT_LINE_COLORS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Record<string, unknown>>;
    for (const k of Object.keys(out) as LineKey[]) {
      const v = saved[k];
      if (typeof v === "string" && HEX.test(v)) out[k] = v.toUpperCase();
    }
  } catch { /* 저장소를 못 쓰면 기본색 */ }
  return out;
}

let current = load();
const listeners = new Set<() => void>();

function commit(next: LineColors) {
  current = next;
  try {
    // 기본색과 다른 것만 저장해 두면 나중에 기본색을 바꿔도 따라간다
    const diff = Object.fromEntries((Object.keys(next) as LineKey[])
      .filter((k) => next[k] !== DEFAULT_LINE_COLORS[k]).map((k) => [k, next[k]]));
    if (Object.keys(diff).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(diff));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* 저장 실패는 이번 화면에서만 적용 */ }
  listeners.forEach((fn) => fn());
}

export function setLineColor(key: LineKey, color: string) {
  if (!HEX.test(color)) return;
  commit({ ...current, [key]: color.toUpperCase() });
}

/** keys 를 주면 그 선만, 안 주면 전부 기본색으로 */
export function resetLineColors(keys?: LineKey[]) {
  const next = { ...current };
  for (const k of keys ?? (Object.keys(next) as LineKey[])) next[k] = DEFAULT_LINE_COLORS[k];
  commit(next);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  // 다른 탭에서 바꾼 색도 반영
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) { current = load(); fn(); }
  };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(fn); window.removeEventListener("storage", onStorage); };
}

/** 그래프에서 쓰는 현재 선 색 */
export function useLineColors(): LineColors {
  return useSyncExternalStore(subscribe, () => current);
}
