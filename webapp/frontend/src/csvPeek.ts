// 업로드 전에 CSV를 브라우저에서 훑어 종류·센서·기간을 미리 보여준다.
// 판별 규칙은 백엔드 ingest.py와 같게 맞춘다 (서버 결과가 최종).

export interface CsvPeek {
  kind: "pressure" | "moisture";
  sensors: { mac: string; first: string; last: string }[];
  period_start: string | null; // ISO, 시간대 없음
  period_end: string | null;
  rows: number;
}

const unquote = (s: string) => s.trim().replace(/^"|"$/g, "").trim();
const toIso = (ts: string) => ts.replace(" ", "T").slice(0, 19);

export async function peekCsv(file: File): Promise<CsvPeek> {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let rest = "";
  let header: string[] | null = null;
  let iMac = -1, iTs = -1;
  let rows = 0;
  const macs = new Map<string, { first: string; last: string; n: number }>();

  const line = (l: string) => {
    if (!l.trim()) return;
    const cells = l.split(",");
    if (!header) {
      header = cells.map(unquote);
      iMac = header.indexOf("mac");
      iTs = header.indexOf("timestamp");
      return;
    }
    const mac = unquote(cells[iMac] ?? "").toUpperCase();
    const ts = unquote(cells[iTs] ?? "");
    if (!mac || !/^\d{4}-\d{2}-\d{2}/.test(ts)) return;
    rows++;
    const m = macs.get(mac);
    if (!m) macs.set(mac, { first: ts, last: ts, n: 1 });
    else {
      m.n++;
      if (ts < m.first) m.first = ts;
      if (ts > m.last) m.last = ts;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const lines = (rest + value).split(/\r?\n/);
    rest = lines.pop() ?? "";
    lines.forEach(line);
  }
  line(rest);

  const cols = new Set<string>(header ?? []);
  if (iMac < 0 || iTs < 0) throw new Error("mac, timestamp 컬럼이 없는 CSV입니다.");
  let kind: CsvPeek["kind"];
  if (cols.has("uf") && !cols.has("press")) kind = "moisture";
  else if (cols.has("press")) kind = "pressure";
  else throw new Error("측압(press) 또는 수분(uf) 컬럼이 없는 CSV입니다.");

  // 깨진 MAC(LoRa 파싱 오류)은 서버도 집계에서 뺀다: 영숫자 4~12자리, 10행 이상
  const sensors = [...macs.entries()]
    .filter(([mac, m]) => /^[0-9A-F]{4,12}$/.test(mac) && m.n >= 10)
    .map(([mac, m]) => ({ mac, first: toIso(m.first), last: toIso(m.last) }))
    .sort((a, b) => a.mac.localeCompare(b.mac));
  const all = [...macs.values()];
  const min = all.reduce<string | null>((a, m) => (a == null || m.first < a ? m.first : a), null);
  const max = all.reduce<string | null>((a, m) => (a == null || m.last > a ? m.last : a), null);
  return { kind, sensors, period_start: min && toIso(min), period_end: max && toIso(max), rows };
}
