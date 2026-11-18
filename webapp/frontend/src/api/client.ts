// 서버(백엔드 API)와 주고받는 모든 것.
// 위쪽: 주고받는 데이터의 모양 (interface = "이런 항목들이 들어 있다"는 약속, 백엔드 schemas.py와 맞춘다)
// 아래쪽: api.xxx() 함수들. 화면은 fetch를 직접 쓰지 않고 이 함수들만 부른다.

/** 타설 회차. pour_* = 사람이 확정한 시각, detected_* = 측압으로 자동 추정한 시각 */
export interface Pour {
  id: number;
  name: string;
  site: string | null;
  pour_start: string | null;
  pour_end: string | null;
  detected_start: string | null;
  detected_end: string | null;
  design_strength: number | null;
  member: Member | null;            // 부재 종류: wall(벽·기둥) / slab(슬래브)
  structure?: Structure | null;     // 슬래브 구조 형식: single(단층) / multi(다층)
  durable?: boolean;                // 벽: 내구성 중요 구조물 (기준 10 MPa)
  removal_override?: number | null; // 해체 기준 직접 입력 (MPa)
  removal_override_reason?: string | null;
  criterion?: Criterion | null;     // 서버가 계산한 해체 기준 (부재 미설정이면 없음)
  sensors: string[];
  note: string | null;
  test_count: number;
  notify_emails?: string | null;    // 알림 메일 받을 주소 (쉼표 구분)
  notice?: Notice | null;           // 마지막으로 보낸 알림 (없으면 아직 안 보냄)
}

/** 보낸 알림 기록: 마지막으로 보낸 시각, 그때의 기준별 예상 시각(키: Milestone.key, 예전 기록은 "5"·"14"), 알림 키별 보낸 시각 */
export interface Notice {
  at: string;
  milestones: Record<string, string | null>;
  sent: Record<string, string>;     // 알림 키별 보낸 시각
}

export type Member = "wall" | "slab";
export const MEMBER_LABEL: Record<Member, string> = { wall: "벽·기둥", slab: "슬래브" };
export type Structure = "single" | "multi";
export const STRUCTURE_LABEL: Record<Structure, string> = { single: "단층 구조", multi: "다층 구조" };

/** 회차의 해체 기준 (백엔드 criteria.py). strength = 실제로 쓰는 값 */
export interface Criterion {
  strength: number;
  auto_strength: number;            // 조건으로 계산한 값
  minimum: number;                  // 직접 입력 하한 (KCS 최소값)
  basis: string;                    // 계산 근거 문구
  warning: string | null;           // 입력이 더 필요할 때 안내
  overridden: boolean;              // 직접 입력 값을 쓰는지
  override_reason: string | null;
}

/** 예측 계산에서 뺀 측정 구간 (원본 데이터는 그대로) */
export interface Exclusion { id: number; pour_id: number; start: string; end: string; reason: string | null }
export type ExclusionIn = Omit<Exclusion, "id" | "pour_id">;

/** 해체 기준 하나(벽체 5 MPa 등)의 도달 시각들. *_age_h = 타설 후 몇 시간 */
export type MilestoneKey = "wall" | "slab" | "design";
export interface Milestone {
  key: MilestoneKey;                // wall·slab = 해체 기준, design = 설계기준강도
  label: string;
  threshold: number;
  expected: string | null;          // 예상 시각 (예측 곡선 기준)
  expected_age_h: number | null;
  conservative: string | null;      // 보수적 시각 (90% 범위 하한 기준)
  conservative_age_h: number | null;
  observed: string | null;          // 공시체 결과로 보간한 실측 도달 시각
  observed_age_h: number | null;
  reached_at_as_of: boolean;        // 기준 시각에 이미 넘었는지
}

/** 강도 예측 결과 (백엔드 maturity.predict). 강도 예측 탭이 이것으로 그려진다 */
export interface Prediction {
  pour_id: number;
  start: string;
  as_of: string;                    // 기준 시각 (이 시각까지 실측 온도 사용)
  data_end: string;                 // 마지막 센서 데이터 시각
  current_strength: number;
  current_range: [number, number];
  strength_28d: number;
  design_ratio_28d: number | null;
  milestones: Milestone[];
  /** 최초 예상: 타설 후 hours 시점에 했을 예측 (현재가 그 이전이면 null) */
  baseline: {
    as_of: string; hours: number;
    series: { age_h: number; strength: number }[];
    milestones: { key: MilestoneKey; label: string; expected: string | null; expected_age_h: number | null }[];
  } | null;
  // 1시간 간격 그래프 점. observed = 실측 온도 구간(true) / 가정 온도 구간(false)
  series: {
    t: string; age_h: number; observed: boolean; temp: number | null; maturity: number;
    strength: number; lower: number; upper: number;
  }[];
  tests: { test_id: number; t: string; age_h: number; fc: number; used_for_calibration: boolean }[];
  model: {
    method: string; calibrated: boolean; calibration_scale: number; calibration_tests: number;
    sigma: number; interval: string; train_pours: number[]; train_specimens: number; fixed_curve: boolean; forecast: string;
    params: Record<string, number>;
  };
}

/** 타설 이력 카드 한 장 (예측 실패 시 error만 있음) */
export interface PourSummary {
  pour: Pour;
  error?: string;
  as_of?: string;
  data_end?: string;
  current_strength?: number;
  strength_28d?: number;
  design_ratio_28d?: number | null;
  milestones?: Milestone[];
}

/** 공시체 시험 결과. 화면에서는 평균 하나를 s1에 넣는다 */
export interface StrengthTest {
  id: number;
  pour_id: number;
  test_datetime: string;
  nominal_age_day: number | null;
  curing: "field" | "water";
  s1: number | null;
  s2: number | null;
  s3: number | null;
  note: string | null;
  average: number | null;
}

export type StrengthTestIn = Omit<StrengthTest, "id" | "pour_id" | "average">;

// label: 표시 이름, hidden: 목록에서 숨김. ⚠ 둘 다 백엔드 미구현 — docs/sensor-data-api-request.md
export interface SensorInfo { mac: string; kind: "pressure" | "moisture"; first: string; last: string; buckets: number; label?: string | null; hidden?: boolean }
export interface SensorPatch { label?: string | null; hidden?: boolean }
export interface SensorDeleteResult { mac: string; rows_deleted: number; pours: number[] }

/** 센서 데이터 화면의 그래프 데이터: 센서별 시각 목록 t와 항목별 값 목록 */
export interface SeriesResponse {
  freq: string;
  sensors: Record<string, { t: string[] } & Partial<Record<Metric, (number | null)[]>>>;
}
export type Metric = "temp_in" | "temp_out" | "humi" | "weight_kg" | "c_mo" | "uf_val";

/** 타설 시점 확인 탭의 1분 측압 */
export interface PourDay {
  date: string;
  series: Record<string, [string, number | null][]>;
  detected_start: string | null; detected_end: string | null;
  pour_start: string | null; pour_end: string | null;
}

export interface UploadResult {
  filename: string; kind: string; rows_total: number; rows_inserted: number;
  period_start: string | null; period_end: string | null; sensors: string[];
}

// 업로드 이력에는 sensors가 없다
// label: 사용자가 붙인 표시 이름 (없으면 filename). ⚠ 백엔드 미구현 — docs/csv-data-api-request.md
export type UploadLog = Omit<UploadResult, "sensors"> & { id: number; created_at: string; label?: string | null };

/** CSV 데이터 삭제 결과. ⚠ 백엔드 미구현 (요청 중) */
export interface UploadDeleteResult { rows_deleted: number; sensors: string[]; period_start: string | null; period_end: string | null }

export interface ChatMessage { role: "user" | "assistant"; content: string }
export interface AgentStep { tool: string; args: Record<string, unknown>; ok: boolean }
export interface AgentReply { answer: string; steps: AgentStep[]; elapsed_ms: number }

/** 서버가 오류를 돌려줬을 때. message에 서버의 설명(detail)이 들어 있다 */
export class ApiError extends Error {}

/** 권한이 바뀌었을 수 있음을 알리는 신호 (auth/AuthContext.tsx 가 듣고 내 정보를 다시 불러온다) */
export const AUTH_CHANGED_EVENT = "demold:auth-changed";

/** 로그인이 끊긴 채(세션 만료·사용 중지) 다른 API를 부르면 로그인 화면으로 보낸다.
 *  권한 부족(403)이면 그사이 권한이 바뀌었을 수 있으니 내 정보를 다시 불러오게 한다 */
function toLoginIfExpired(path: string, res: Response) {
  if (res.status === 401 && !path.startsWith("/api/auth/") && location.pathname !== "/login") {
    location.assign("/login");
  }
  if (res.status === 403) window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

/** 서버에 요청을 보내고 JSON 결과를 받는다. 실패하면 서버가 준 오류 문구로 ApiError를 던진다 */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  toLoginIfExpired(path, res);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") msg = body.detail;
      // 입력 검사 오류(422)는 [{msg: "Value error, …"}] 목록으로 온다 → 문구만 꺼낸다
      else if (Array.isArray(body.detail)) msg = body.detail.map((d: { msg?: string }) => (d.msg ?? "").replace(/^Value error, /, "")).join(" / ");
    } catch { /* 본문 없음 */ }
    throw new ApiError(msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** JSON 본문을 담은 요청 설정 (POST·PATCH·PUT용) */
export const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

/** 서버 API 목록. 백엔드 routers/ 폴더의 경로와 1:1로 대응한다 */
export const api = {
  // 타설 회차 (routers/pours.py)
  pours: () => request<Pour[]>("/api/pours"),
  summary: () => request<PourSummary[]>("/api/pours/summary"),
  pour: (id: number) => request<Pour>(`/api/pours/${id}`),
  createPour: (body: Partial<Pour>) => request<Pour>("/api/pours", json("POST", body)),
  updatePour: (id: number, body: Partial<Pour>) => request<Pour>(`/api/pours/${id}`, json("PATCH", body)),
  deletePour: (id: number) => request<void>(`/api/pours/${id}`, { method: "DELETE" }),
  detect: (id: number, date?: string) =>
    request<Pour>(`/api/pours/${id}/detect${date ? `?date=${encodeURIComponent(date)}` : ""}`, { method: "POST" }),
  prediction: (id: number, asOf?: string) =>
    request<Prediction>(`/api/pours/${id}/prediction${asOf ? `?as_of=${encodeURIComponent(asOf)}` : ""}`),
  pourDay: (id: number, date?: string) =>
    request<PourDay>(`/api/pours/${id}/pour-day${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  // 공시체 결과
  tests: (id: number) => request<StrengthTest[]>(`/api/pours/${id}/tests`),
  addTest: (id: number, body: StrengthTestIn) => request<StrengthTest>(`/api/pours/${id}/tests`, json("POST", body)),
  updateTest: (id: number, testId: number, body: StrengthTestIn) =>
    request<StrengthTest>(`/api/pours/${id}/tests/${testId}`, json("PUT", body)),
  deleteTest: (id: number, testId: number) =>
    request<void>(`/api/pours/${id}/tests/${testId}`, { method: "DELETE" }),
  // 알림 메일 초안을 열었음을 기록 (같은 알림 반복 방지, 예측 변경 판단 기준)
  recordNotice: (id: number, body: { key: string; milestones: Record<string, string | null> }) =>
    request<Pour>(`/api/pours/${id}/notice`, json("POST", body)),
  // 제외 구간
  exclusions: (id: number) => request<Exclusion[]>(`/api/pours/${id}/exclusions`),
  addExclusion: (id: number, body: ExclusionIn) =>
    request<Exclusion>(`/api/pours/${id}/exclusions`, json("POST", body)),
  deleteExclusion: (id: number, exId: number) =>
    request<void>(`/api/pours/${id}/exclusions/${exId}`, { method: "DELETE" }),
  // 센서 데이터·업로드 (routers/sensors.py)
  sensors: () => request<SensorInfo[]>("/api/sensors"),
  // ⚠ 백엔드 미구현 (docs/sensor-data-api-request.md). 화면은 api/sensors.ts 를 거쳐 부른다
  updateSensor: (mac: string, patch: SensorPatch) => request<SensorInfo>(`/api/sensors/${encodeURIComponent(mac)}`, json("PATCH", patch)),
  deleteSensor: (mac: string) => request<SensorDeleteResult>(`/api/sensors/${encodeURIComponent(mac)}`, { method: "DELETE" }),
  series: (macs: string[], start: string, end: string) => {
    const q = new URLSearchParams({ start, end });
    macs.forEach((m) => q.append("macs", m));
    return request<SeriesResponse>(`/api/sensors/series?${q}`);
  },
  upload: (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    return request<UploadResult[]>("/api/upload", { method: "POST", body: fd });
  },
  uploads: () => request<UploadLog[]>("/api/uploads"),
  // ⚠ 아래 두 API는 백엔드에 아직 없다. 화면은 api/uploads.ts 를 거쳐 목업(uploadsMock.ts)을 쓴다
  renameUpload: (id: number, label: string | null) => request<UploadLog>(`/api/uploads/${id}`, json("PATCH", { label })),
  deleteUpload: (id: number) => request<UploadDeleteResult>(`/api/uploads/${id}`, { method: "DELETE" }),
  // AI 상담 (routers/agent.py)
  ask: (question: string, history: ChatMessage[]) =>
    request<AgentReply>("/api/agent/ask", json("POST", { question, history })),
  askStream,
};

/** AI 상담 스트리밍 이벤트 (서버가 한 줄에 하나씩 보냄) */
export type AgentEvent =
  | ({ type: "step" } & AgentStep)              // 도구 하나를 실행함
  | { type: "delta"; text: string }             // 답변 글자 조각
  | { type: "reset" }                           // 지금까지 받은 글자는 답이 아니었음 → 지움
  | ({ type: "done" } & AgentReply)             // 끝 (answer = 최종 답변 전체)
  | { type: "error"; message: string };         // 실패

/** AI에게 질문하고, 진행 상황·답변 글자를 오는 대로 onEvent 로 넘긴다. 서버가 error 이벤트를 보내면 ApiError 를 던진다 */
async function askStream(question: string, history: ChatMessage[], onEvent: (e: AgentEvent) => void): Promise<void> {
  const res = await fetch("/api/agent/ask/stream", json("POST", { question, history }));
  toLoginIfExpired("/api/agent/ask/stream", res);
  if (!res.ok || !res.body) {
    let msg = `${res.status} ${res.statusText}`;
    try { const b = await res.json(); if (typeof b.detail === "string") msg = b.detail; } catch { /* 본문 없음 */ }
    throw new ApiError(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    buf += decoder.decode(value, { stream: !done });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";            // 마지막 줄은 아직 덜 왔을 수 있어 남겨 둔다
    for (const line of lines) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line) as AgentEvent;
      if (ev.type === "error") throw new ApiError(ev.message);
      onEvent(ev);
    }
    if (done) break;
  }
}
