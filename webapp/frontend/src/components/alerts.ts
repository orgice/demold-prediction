// 강도 알림과 알림 메일 초안 (수행계획서 '탈형 시점 메일 알림' [필수], 협의 7 기본안)
//   - 메일은 자동으로 '작성'만 하고, 발송은 사용자가 메일 앱에서 확인 후 직접 한다 (SMTP 발송 없음)
//   - 메일 내용은 모두 예측 결과 숫자로 코드가 채운다 (LLM 미사용: 숫자가 틀리면 안 되는 안내문)
//
// 알림 4종류
//   new     : 진행 중 회차의 예측이 처음 나왔을 때 (아직 한 번도 알리지 않음)
//   changed : 진행 중 회차의 기준 도달 예상 시각이, 마지막으로 알린 때보다 CHANGE_HOURS 이상 달라졌을 때
//   soon    : 진행 중 회차가 24시간 안에 기준 강도에 닿을 때
//   under   : 28일 예측 강도가 기준보다 낮을 때
// 진행 중 = 예측 기준 시각(마지막 데이터)이 3시간 이내 (센서 데이터가 지금 들어오는 회차)
// 같은 알림(같은 key)은 메일 초안을 한 번 열면 '보냄'으로 기록되어 종 아이콘 숫자에서 빠진다.
import { MEMBER_LABEL, Milestone, Pour, Prediction } from "../api/client";
import { fmtDateTime, hoursBetween } from "../format";

export const CHANGE_HOURS = 6;     // 예상 시각이 이만큼 달라지면 '예측 변경'으로 알린다
const LIVE_HOURS = 3;
const SOON_HOURS = 24;

export type AlertKind = "new" | "changed" | "soon" | "under";
export const KIND_LABEL: Record<AlertKind, string> = {
  new: "예측 시작", changed: "예측 변경", soon: "도달 임박", under: "강도 도달 주의",
};

export interface AlertItem {
  pour: Pour;
  pred: Prediction;
  kind: AlertKind;
  key: string;            // 같은 알림인지 판단하는 키 (보냄 기록에 쓰임)
  text: string;           // 화면·메일에 쓰는 한두 문장
  sentAt: string | null;  // 이 알림 메일 초안을 연 시각 (없으면 아직 안 보냄)
}

/** 이 회차에서 알릴 기준: 부재 종류를 정했으면 그 기준만(벽 5 / 슬래브 14), 아니면 둘 다. 설계강도는 입력했으면 추가 */
export function targetsOf(pour: Pour): number[] {
  const base = pour.member === "wall" ? [5] : pour.member === "slab" ? [14] : [5, 14];
  return pour.design_strength ? [...base, pour.design_strength] : base;
}

const nowLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19); };

/** 진행 중인지: 마지막 데이터가 3시간 이내 */
export const isLive = (pred: Prediction) => hoursBetween(pred.as_of, nowLocal()) < LIVE_HOURS;

/** 알릴 기준의 도달 예상 시각 {"14": "2026-07-05T08:50:00", ...} (보냄 기록에 함께 저장) */
export function milestoneSnapshot(pour: Pour, pred: Prediction): Record<string, string | null> {
  const t = targetsOf(pour);
  return Object.fromEntries(pred.milestones.filter((m) => t.includes(m.threshold)).map((m) => [String(m.threshold), m.expected]));
}

function shift(prev: string | null, cur: string | null) {
  if (prev && cur) {
    const h = hoursBetween(prev, cur);
    return Math.abs(h) >= CHANGE_HOURS ? `${fmtDateTime(prev)} → ${fmtDateTime(cur)} (${Math.abs(Math.round(h))}시간 ${h > 0 ? "늦어짐" : "빨라짐"})` : null;
  }
  if (prev && !cur) return `${fmtDateTime(prev)} → 28일 내 미도달 예상`;
  if (!prev && cur) return `28일 내 미도달 → ${fmtDateTime(cur)}`;
  return null;
}

/** 회차 하나의 알림 목록 */
export function alertsFor(pour: Pour, pred: Prediction): AlertItem[] {
  const out: Omit<AlertItem, "sentAt">[] = [];
  const targets = targetsOf(pour);
  const ms = pred.milestones.filter((m) => targets.includes(m.threshold));
  const notice = pour.notice;

  if (isLive(pred)) {
    if (!notice) {
      out.push({ pour, pred, kind: "new", key: "new",
        text: `강도 예측이 나왔습니다. ${ms.map((m) => `${m.label} ${m.reached_at_as_of ? "도달" : m.expected ? `${fmtDateTime(m.expected)} 예상` : "28일 내 미도달 예상"}`).join(", ")}.` });
    } else {
      const moved = ms.map((m) => ({ m, s: shift(notice.milestones[String(m.threshold)] ?? null, m.expected) }))
        .filter((x) => !x.m.reached_at_as_of && x.s);   // 이미 도달한 기준은 제외
      if (moved.length) {
        out.push({ pour, pred, kind: "changed",
          key: `changed:${moved.map((x) => `${x.m.threshold}@${(x.m.expected ?? "none").slice(0, 13)}`).join("|")}`,
          text: `마지막 알림 이후 예상 시각이 바뀌었습니다. ${moved.map((x) => `${x.m.label}: ${x.s}`).join(" / ")}.` });
      }
    }
    for (const m of ms) {
      if (m.reached_at_as_of || !m.expected) continue;
      const h = hoursBetween(pred.as_of, m.expected);
      if (h >= 0 && h <= SOON_HOURS) {
        out.push({ pour, pred, kind: "soon", key: `soon:${m.threshold}`,
          text: `${m.label} 도달 예상 ${fmtDateTime(m.expected)} (약 ${Math.max(1, Math.round(h))}시간 후)${m.conservative ? `, 보수적 ${fmtDateTime(m.conservative)}` : ""}.` });
      }
    }
  }

  const under = targets.filter((v) => pred.strength_28d < v);
  if (under.length) {
    out.push({ pour, pred, kind: "under", key: `under:${under.join(",")}`,
      text: `28일 예측 강도 ${pred.strength_28d.toFixed(1)} MPa가 ${under.map((v) => `${v} MPa`).join(", ")} 기준보다 낮습니다. 양생 관리가 필요합니다.` });
  }
  return out.map((a) => ({ ...a, sentAt: notice?.sent[a.key] ?? null }));
}

/** 메일 받는 사람 목록 (회차 설정에서 입력) */
export const recipients = (pour: Pour) => (pour.notify_emails ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** 알림 메일 초안: 제목과 본문. 숫자는 모두 예측 결과에서 그대로 가져온다 */
export function mailDraft(a: AlertItem, pageUrl: string) {
  const { pour, pred } = a;
  const name = [pour.name, pour.member ? MEMBER_LABEL[pour.member] : null].filter(Boolean).join(" · ");
  const ms = pred.milestones.filter((m) => targetsOf(pour).includes(m.threshold));
  const line = (m: Milestone) => {
    if (m.reached_at_as_of) return `- ${m.label}: 도달${m.expected ? ` (${fmtDateTime(m.expected)} 무렵)` : ""}`;
    if (!m.expected) return `- ${m.label}: 28일 안에 도달하지 않을 것으로 예상`;
    return `- ${m.label}: ${fmtDateTime(m.expected)} 도달 예상 (보수적 ${m.conservative ? fmtDateTime(m.conservative) : "28일 내 미도달"})`;
  };
  const subject = `[FormCast] ${name} · ${KIND_LABEL[a.kind]}`;
  const body = [
    "안녕하세요. FormCast 강도 예측 알림입니다.",
    "",
    `■ 회차: ${pour.name}${pour.site ? ` (${pour.site})` : ""}`,
    `■ 부재: ${pour.member ? MEMBER_LABEL[pour.member] : "미지정"} / 설계기준강도: ${pour.design_strength ? `${pour.design_strength} MPa` : "미입력"}`,
    `■ 알림: ${a.text}`,
    "",
    `[기준별 도달 예상] 예측 기준 시각 ${fmtDateTime(pred.as_of)}`,
    ...ms.map(line),
    `- 현재 추정 강도: ${pred.current_strength.toFixed(1)} MPa (90% 범위 ${pred.current_range[0].toFixed(1)}–${pred.current_range[1].toFixed(1)})`,
    `- 28일 예측 강도: ${pred.strength_28d.toFixed(1)} MPa`,
    "",
    "보수적 시각은 90% 하한이 기준에 닿는 시각입니다. 현장 판단에는 보수적 시각을 권장합니다.",
    `자세히 보기: ${pageUrl}`,
    "",
    "※ 예측값은 참고 정보입니다. 거푸집 해체는 현장양생 공시체 강도 확인과 현장 책임자 승인 후에 합니다.",
  ].join("\n");
  return { subject, body };
}

/** 기본 메일 앱을 여는 주소 (받는 사람·제목·본문이 채워진 초안) */
export function mailtoUrl(a: AlertItem, pageUrl: string) {
  const { subject, body } = mailDraft(a, pageUrl);
  const to = recipients(a.pour).map(encodeURIComponent).join(",");
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
