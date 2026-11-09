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
  sensors: string[];
  note: string | null;
  test_count: number;
}

/** 해체 기준 하나(벽체 5 MPa 등)의 도달 시각들. *_age_h = 타설 후 몇 시간 */
export interface Milestone {
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
    milestones: { label: string; expected: string | null; expected_age_h: number | null }[];
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

export interface SensorInfo { mac: string; kind: "pressure" | "moisture"; first: string; last: string; buckets: number }

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
export type UploadLog = Omit<UploadResult, "sensors"> & { id: number; created_at: string };

export interface ChatMessage { role: "user" | "assistant"; content: string }
export interface AgentStep { tool: string; args: Record<string, unknown>; ok: boolean }
export interface AgentReply { answer: string; steps: AgentStep[]; elapsed_ms: number }

/** 서버가 오류를 돌려줬을 때. message에 서버의 설명(detail)이 들어 있다 */
export class ApiError extends Error {}

/** 서버에 요청을 보내고 JSON 결과를 받는다. 실패하면 서버가 준 오류 문구로 ApiError를 던진다 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.detail) msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch { /* 본문 없음 */ }
    throw new ApiError(msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** JSON 본문을 담은 요청 설정 (POST·PATCH·PUT용) */
const json = (method: string, body: unknown): RequestInit => ({
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
  // 센서 데이터·업로드 (routers/sensors.py)
  sensors: () => request<SensorInfo[]>("/api/sensors"),
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
  // AI 상담 (routers/agent.py)
  ask: (question: string, history: ChatMessage[]) =>
    request<AgentReply>("/api/agent/ask", json("POST", { question, history })),
};
