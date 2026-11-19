// ⚠ 백엔드 미연동 목업: CSV 이름 변경·삭제를 이 브라우저(localStorage)에만 기록한다.
// 실제 DB의 센서 데이터·업로드 기록·그래프는 바뀌지 않는다. 다른 PC나 다른 사람 화면에도 반영되지 않는다.
// 실제 API 연동 시 uploads.ts 의 UPLOADS_IS_MOCK 을 false 로 바꾸고 이 파일은 지운다.
import type { UploadDeleteResult, UploadLog } from "./client";

const KEY = "formcast.mock.uploads";
interface Overlay { labels: Record<string, string>; deleted: number[] }

const delay = (ms = 400) => new Promise((r) => setTimeout(r, ms));

function read(): Overlay {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Overlay> | null;
    return { labels: o?.labels ?? {}, deleted: o?.deleted ?? [] };
  } catch { return { labels: {}, deleted: [] }; }
}
function write(o: Overlay) {
  try {
    if (!Object.keys(o.labels).length && !o.deleted.length) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(o));
  } catch { /* 저장 실패 시 이번 화면에서만 반영 */ }
}

export const mockUploads = {
  /** 서버 목록에 이 브라우저의 이름 변경·삭제 표시를 덧입힌다 */
  apply(list: UploadLog[]): UploadLog[] {
    const o = read();
    return list.filter((u) => !o.deleted.includes(u.id))
      .map((u) => (o.labels[u.id] ? { ...u, label: o.labels[u.id] } : u));
  },
  async rename(u: UploadLog, label: string | null): Promise<UploadLog> {
    await delay();
    if (label && label.length > 100) throw new Error("이름은 100자 이내로 입력해 주세요.");
    const o = read();
    if (label && label !== u.filename) o.labels[u.id] = label; else delete o.labels[u.id];
    write(o);
    return { ...u, label: o.labels[u.id] ?? null };
  },
  async remove(u: UploadLog): Promise<UploadDeleteResult> {
    await delay(700);
    const o = read();
    if (!o.deleted.includes(u.id)) o.deleted.push(u.id);
    delete o.labels[u.id];
    write(o);
    // 목업이라 실제로 지운 행은 없다. 화면 흐름 확인용으로 이 업로드가 저장했던 행 수를 돌려준다
    return { rows_deleted: u.rows_inserted, sensors: [], period_start: u.period_start, period_end: u.period_end };
  },
};
