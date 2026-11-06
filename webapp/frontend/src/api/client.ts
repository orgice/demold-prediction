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

export interface Milestone {
  label: string;
  threshold: number;
  expected: string | null;
  expected_age_h: number | null;
  conservative: string | null;
  conservative_age_h: number | null;
  observed: string | null;
  observed_age_h: number | null;
  reached_at_as_of: boolean;
}

export interface Prediction {
  pour_id: number;
  start: string;
  as_of: string;
  data_end: string;
  current_strength: number;
  current_range: [number, number];
  strength_28d: number;
  design_ratio_28d: number | null;
  milestones: Milestone[];
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

export interface SeriesResponse {
  freq: string;
  sensors: Record<string, { t: string[] } & Partial<Record<Metric, (number | null)[]>>>;
}
export type Metric = "temp_in" | "temp_out" | "humi" | "weight_kg" | "c_mo" | "uf_val";

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

export class ApiError extends Error {}

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

const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

export const api = {
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
  tests: (id: number) => request<StrengthTest[]>(`/api/pours/${id}/tests`),
  addTest: (id: number, body: StrengthTestIn) => request<StrengthTest>(`/api/pours/${id}/tests`, json("POST", body)),
  updateTest: (id: number, testId: number, body: StrengthTestIn) =>
    request<StrengthTest>(`/api/pours/${id}/tests/${testId}`, json("PUT", body)),
  deleteTest: (id: number, testId: number) =>
    request<void>(`/api/pours/${id}/tests/${testId}`, { method: "DELETE" }),
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
  ask: (question: string, history: ChatMessage[]) =>
    request<AgentReply>("/api/agent/ask", json("POST", { question, history })),
};
