// 강도 알림과 알림 메일 초안 (수행계획서 '탈형 시점 메일 알림' [필수])
//   - 서버에 SMTP 를 설정하면 서버가 같은 규칙으로 찾아서 자동 발송한다 (backend/app/notify.py, 규칙을 바꾸면 함께 바꾼다)
//   - SMTP 가 없으면 메일은 자동으로 '작성'만 하고, 발송은 사용자가 메일 앱에서 확인 후 직접 한다
//   - 메일 내용은 모두 예측 결과 숫자로 코드가 채운다 (LLM 미사용: 숫자가 틀리면 안 되는 안내문)
//
// 알림은 한 가지: 부재 해체 기준 강도에 도달하기 하루 전
//   지금 시각이 해체 기준 도달 예상 시각의 24시간 전 이후이고, 아직 기준에 도달하지 않았을 때.
//   기준 = 회차의 해체 기준(backend/app/criteria.py). 부재 미설정이면 벽 5·슬래브 14 MPa 각각. 설계기준강도는 알리지 않음.
//   같은 기준은 한 번만 알린다 (해체 기준 값을 바꾸면 새 기준으로 다시 알림).
// 같은 알림(같은 key)은 메일 초안을 열거나 서버가 자동 발송하면 '보냄'으로 기록되어 종 아이콘 숫자에서 빠진다.
import { MEMBER_LABEL, Milestone, Pour, Prediction } from "../api/client";
import { fmtDateTime, hoursBetween } from "../format";

export const BEFORE_HOURS = 24;    // 해체 기준 도달 예상 시각보다 이만큼 먼저 알린다
const STALE_HOURS = 24;            // 예상 시각이 이보다 더 지났으면 알리지 않는다 (오래된 회차)

export type AlertKind = "dayBefore";
export const KIND_LABEL: Record<AlertKind, string> = { dayBefore: "해체 기준 도달 하루 전" };

export interface AlertItem {
  pour: Pour;
  pred: Prediction;
  kind: AlertKind;
  key: string;            // 같은 알림인지 판단하는 키 (보냄 기록에 쓰임)
  text: string;           // 화면·메일에 쓰는 한두 문장
  sentAt: string | null;  // 이 알림 메일 초안을 연(또는 서버가 자동 발송한) 시각 (없으면 아직 안 보냄)
  auto: boolean;          // 서버가 자동 발송했는지
}

/** 알릴 기준 = 해체 기준 (설계기준강도 제외) */
const targetsOf = (pred: Prediction): Milestone[] => pred.milestones.filter((m) => m.key !== "design");

const nowLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19); };

/** 기준별 도달 예상 시각 {"slab": "2026-07-05T08:50:00", ...} (보냄 기록에 함께 저장) */
export function milestoneSnapshot(pred: Prediction): Record<string, string | null> {
  return Object.fromEntries(targetsOf(pred).map((m) => [m.key, m.expected]));
}

/** 회차 하나의 알림 목록 */
export function alertsFor(pour: Pour, pred: Prediction): AlertItem[] {
  const now = nowLocal();
  const out: Omit<AlertItem, "sentAt" | "auto">[] = [];
  for (const m of targetsOf(pred)) {
    if (m.reached_at_as_of || !m.expected) continue;
    const h = hoursBetween(now, m.expected);   // 예상 시각까지 남은 시간
    if (h > BEFORE_HOURS || h < -STALE_HOURS) continue;
    const when = h >= 0 ? `약 ${Math.max(1, Math.round(h))}시간 후` : "예상 시각이 지났습니다. 공시체로 확인하세요";
    out.push({ pour, pred, kind: "dayBefore", key: `dayBefore:${m.key}${m.threshold}`,
      text: `${m.label} 도달 예상 ${fmtDateTime(m.expected)} (${when})${m.conservative ? `, 보수적 ${fmtDateTime(m.conservative)}` : ""}.` });
  }
  const notice = pour.notice;
  return out.map((a) => ({ ...a, sentAt: notice?.sent[a.key] ?? null, auto: !!notice?.auto?.[a.key] }));
}

/** 메일 받는 사람 목록 (회차 설정에서 입력) */
export const recipients = (pour: Pour) => (pour.notify_emails ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** 알림 메일 초안: 제목과 본문. 숫자는 모두 예측 결과에서 그대로 가져온다 */
export function mailDraft(a: AlertItem, pageUrl: string) {
  const { pour, pred } = a;
  const name = [pour.name, pour.member ? MEMBER_LABEL[pour.member] : null].filter(Boolean).join(" · ");
  const ms = targetsOf(pred);
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
    `■ 해체 기준: ${pour.criterion ? `${pour.criterion.strength} MPa (${pour.criterion.basis}${pour.criterion.overridden && pour.criterion.override_reason ? `, 사유: ${pour.criterion.override_reason}` : ""})` : "부재 미지정 (벽체 5 MPa·슬래브 14 MPa 최소값 표시)"}`,
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
