// ⚠ 백엔드 미연동 목업: 센서 이름 변경·숨기기·삭제를 이 브라우저(localStorage)에만 기록한다.
// 실제 DB의 센서 데이터·회차 연결·그래프·예측은 바뀌지 않는다. 다른 PC나 다른 사람 화면에도 반영되지 않는다.
// 실제 API 연동 시 sensors.ts 의 SENSORS_IS_MOCK 을 false 로 바꾸고 이 파일은 지운다.
import type { Pour, SensorDeleteResult, SensorInfo, SensorPatch } from "./client";

const KEY = "formcast.mock.sensors";
interface Overlay { labels: Record<string, string>; hidden: string[]; deleted: string[] }

const delay = (ms = 400) => new Promise((r) => setTimeout(r, ms));

function read(): Overlay {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Overlay> | null;
    return { labels: o?.labels ?? {}, hidden: o?.hidden ?? [], deleted: o?.deleted ?? [] };
  } catch { return { labels: {}, hidden: [], deleted: [] }; }
}
function write(o: Overlay) {
  try {
    if (!Object.keys(o.labels).length && !o.hidden.length && !o.deleted.length) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(o));
  } catch { /* 저장 실패 시 이번 화면에서만 반영 */ }
}
const withOverlay = (s: SensorInfo, o: Overlay): SensorInfo =>
  ({ ...s, label: o.labels[s.mac] ?? null, hidden: o.hidden.includes(s.mac) });

export const mockSensors = {
  /** 서버 목록에 이 브라우저의 이름·숨김·삭제 표시를 덧입힌다 (삭제한 센서는 빠짐) */
  apply(list: SensorInfo[]): SensorInfo[] {
    const o = read();
    return list.filter((s) => !o.deleted.includes(s.mac)).map((s) => withOverlay(s, o));
  },
  async update(s: SensorInfo, patch: SensorPatch): Promise<SensorInfo> {
    await delay();
    const o = read();
    if ("label" in patch) {
      const label = patch.label?.trim() || null;
      if (label && label.length > 50) throw new Error("이름은 50자 이내로 입력해 주세요.");
      if (label && label !== s.mac) o.labels[s.mac] = label; else delete o.labels[s.mac];
    }
    if (patch.hidden !== undefined) {
      o.hidden = o.hidden.filter((m) => m !== s.mac);
      if (patch.hidden) o.hidden.push(s.mac);
    }
    write(o);
    return withOverlay(s, o);
  },
  async remove(s: SensorInfo, pours: Pour[]): Promise<SensorDeleteResult> {
    await delay(700);
    const o = read();
    if (!o.deleted.includes(s.mac)) o.deleted.push(s.mac);
    delete o.labels[s.mac];
    o.hidden = o.hidden.filter((m) => m !== s.mac);
    write(o);
    // 목업이라 실제로 지운 행은 없다 (행 수 0). 연결 회차는 화면 안내용으로 계산해 돌려준다
    return { mac: s.mac, rows_deleted: 0, pours: pours.filter((p) => p.sensors.includes(s.mac)).map((p) => p.id) };
  },
};
