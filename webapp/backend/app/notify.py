"""강도 알림 메일 자동 발송 (SMTP).

SMTP_HOST 를 설정하면 서버가 NOTIFY_INTERVAL_MIN 분마다 진행 중인 회차를 확인해서,
아직 보내지 않은 알림이 있으면 회차 설정의 '알림 받을 메일' 주소로 바로 보낸다.
SMTP_HOST 가 비어 있으면 자동 발송은 꺼지고, 지금처럼 화면에서 메일 초안만 연다.

알림 규칙·문구는 화면의 frontend/src/components/alerts.ts 와 같다 (바꿀 때 두 곳을 함께 바꾼다).
알림은 한 가지: 부재 해체 기준 강도에 도달하기 하루 전
    지금 시각이 해체 기준 도달 예상 시각의 24시간 전 이후이고, 아직 기준에 도달하지 않았을 때.
    기준 = 회차의 해체 기준(criteria.py). 부재 미설정이면 벽 5·슬래브 14 MPa 각각. 설계기준강도는 알리지 않음.
    같은 기준은 한 번만 알린다 (해체 기준 값을 바꾸면 새 기준으로 다시 알림).

자동 발송 대상
    - 알림 받을 메일이 있는 회차만 (없으면 건너뜀 → 화면에서 초안으로 처리)
    - 타설 후 28일이 지나지 않은 회차만 (켜자마자 지난 회차의 알림이 한꺼번에 나가지 않도록)
    - 한 회차에 알림이 여러 개면 메일 한 통으로 묶는다
보낸 알림은 화면의 '메일 초안 열기'와 같은 보냄 기록(pour.notice)에 남아 종 아이콘 숫자에서 빠지고,
변경 기록(audit_log)에 '알림 메일 자동 발송'으로 남는다. 발송에 실패하면 기록하지 않고 다음 확인 때 다시 보낸다.
"""
import json
import smtplib
import ssl
import threading
import time
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from . import audit, criteria, maturity
from .config import (APP_URL, NOTIFY_INTERVAL_MIN, SMTP_FROM, SMTP_FROM_NAME, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT,
                     SMTP_SECURITY, SMTP_USER)
from .db import SessionLocal, engine
from .models import Pour
from .security import kst_now

BEFORE_HOURS = 24    # 해체 기준 도달 예상 시각보다 이만큼 먼저 알린다
STALE_HOURS = 24     # 예상 시각이 이보다 더 지났으면 알리지 않는다
ACTIVE_DAYS = 28     # 타설 후 이 기간까지만 자동 발송
KIND_LABEL = {"dayBefore": "해체 기준 도달 하루 전"}
MEMBER_LABEL = {"wall": "벽·기둥", "slab": "슬래브"}

ENABLED = bool(SMTP_HOST)
# 화면에 보여 줄 상태 (GET /api/notify/status)
status: dict = {"last_run": None, "last_sent": None, "last_error": None, "sent_count": 0}
_lock = threading.Lock()   # 확인 작업이 겹치지 않게


# ---------- 보냄 기록 (화면의 '메일 초안 열기'와 자동 발송이 같이 쓴다) ----------
def save_notice(p: Pour, keys: list[str], milestones: dict, auto: bool) -> None:
    """알림을 보냈다고 pour.notice 에 기록한다 (commit 은 부르는 쪽에서).
    milestones = 그때의 기준별 예상 시각 {"slab": "2026-07-05T08:50:00", ...}, auto = 서버 자동 발송 여부."""
    old = json.loads(p.notice) if p.notice else {}
    sent, auto_sent = old.get("sent", {}), old.get("auto", {})
    now = kst_now().isoformat()
    for k in keys:
        sent.pop(k, None)
        sent[k] = now
        auto_sent.pop(k, None)
        if auto:
            auto_sent[k] = now
    p.notice = json.dumps({"at": now,
                           "milestones": {k: v.isoformat() if isinstance(v, datetime) else v for k, v in milestones.items()},
                           "sent": dict(list(sent.items())[-50:]),   # 오래된 기록은 50개까지만
                           "auto": {k: v for k, v in auto_sent.items() if k in sent}})


# ---------- 알림 찾기 (alerts.ts 의 alertsFor 와 같은 규칙) ----------
def _dt(s: str) -> datetime:
    return datetime.fromisoformat(s[:19])


def fmt(s: str | None) -> str:
    """'2026-07-05T08:50:00' → '7/5 08:50' (화면 fmtDateTime 과 같은 모양)."""
    if not s:
        return "—"
    d = _dt(s)
    return f"{d.month}/{d.day} {d:%H:%M}"


def _num(v: float) -> str:
    """16.0 → '16', 14.5 → '14.5' (화면에서 숫자를 문자열로 바꾼 모양과 맞춘다. 알림 키에 쓰임)."""
    return f"{v:g}"


def alerts_for(p: Pour, pred: dict, now: datetime) -> list[dict]:
    """회차 하나의 알림 목록 [{kind, key, text}] (이미 보낸 것도 포함)."""
    out = []
    for m in pred["milestones"]:
        if m["key"] == "design" or m["reached_at_as_of"] or not m["expected"]:
            continue
        h = (_dt(m["expected"]) - now).total_seconds() / 3600   # 예상 시각까지 남은 시간
        if h > BEFORE_HOURS or h < -STALE_HOURS:
            continue
        when = f"약 {max(1, round(h))}시간 후" if h >= 0 else "예상 시각이 지났습니다. 공시체로 확인하세요"
        cons = f", 보수적 {fmt(m['conservative'])}" if m["conservative"] else ""
        out.append({"kind": "dayBefore", "key": f"dayBefore:{m['key']}{_num(m['threshold'])}",
                    "text": f"{m['label']} 도달 예상 {fmt(m['expected'])} ({when}){cons}."})
    return out


def recipients(p: Pour) -> list[str]:
    return [a.strip() for a in (p.notify_emails or "").split(",") if a.strip()]


# ---------- 메일 내용 (alerts.ts 의 mailDraft 와 같은 내용, 여러 알림을 한 통으로) ----------
def compose(p: Pour, pred: dict, alerts: list[dict]) -> tuple[str, str]:
    name = " · ".join(x for x in [p.name, MEMBER_LABEL.get(p.member or "")] if x)
    subject = f"[FormCast] {name} · {', '.join(dict.fromkeys(KIND_LABEL[a['kind']] for a in alerts))}"
    c = criteria.criterion(p)
    if c:
        reason = f", 사유: {c['override_reason']}" if c["overridden"] and c["override_reason"] else ""
        crit = f"{_num(c['strength'])} MPa ({c['basis']}{reason})"
    else:
        crit = "부재 미지정 (벽체 5 MPa·슬래브 14 MPa 최소값 표시)"

    def line(m):
        if m["reached_at_as_of"]:
            return f"- {m['label']}: 도달" + (f" ({fmt(m['expected'])} 무렵)" if m["expected"] else "")
        if not m["expected"]:
            return f"- {m['label']}: 28일 안에 도달하지 않을 것으로 예상"
        cons = fmt(m["conservative"]) if m["conservative"] else "28일 내 미도달"
        return f"- {m['label']}: {fmt(m['expected'])} 도달 예상 (보수적 {cons})"

    lo, hi = pred["current_range"]
    body = "\n".join([
        "안녕하세요. FormCast 강도 예측 알림입니다. (자동 발송)",
        "",
        f"■ 회차: {p.name}" + (f" ({p.site})" if p.site else ""),
        f"■ 부재: {MEMBER_LABEL.get(p.member or '', '미지정')} / 설계기준강도: "
        + (f"{_num(p.design_strength)} MPa" if p.design_strength else "미입력"),
        f"■ 해체 기준: {crit}",
        *[f"■ {KIND_LABEL[a['kind']]}: {a['text']}" for a in alerts],
        "",
        f"[기준별 도달 예상] 예측 기준 시각 {fmt(pred['as_of'])}",
        *[line(m) for m in pred["milestones"]],
        f"- 현재 추정 강도: {pred['current_strength']:.1f} MPa (90% 범위 {lo:.1f}–{hi:.1f})",
        f"- 28일 예측 강도: {pred['strength_28d']:.1f} MPa",
        "",
        "보수적 시각은 90% 하한이 기준에 닿는 시각입니다. 현장 판단에는 보수적 시각을 권장합니다.",
        f"자세히 보기: {APP_URL.rstrip('/')}/pours/{p.id}",
        "",
        "※ 예측값은 참고 정보입니다. 거푸집 해체는 현장양생 공시체 강도 확인과 현장 책임자 승인 후에 합니다.",
        "※ 이 메일은 발신 전용입니다. 받는 사람 변경은 FormCast 회차 설정에서 합니다.",
    ])
    return subject, body


# ---------- SMTP ----------
def send_mail(to: list[str], subject: str, body: str) -> None:
    """메일 한 통 보내기. 실패하면 예외."""
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((SMTP_FROM_NAME, SMTP_FROM)) if SMTP_FROM_NAME else SMTP_FROM
    msg["To"] = ", ".join(to)
    msg["Message-ID"] = make_msgid(domain=SMTP_FROM.split("@")[-1] if "@" in SMTP_FROM else None)
    msg.set_content(body)
    ctx = ssl.create_default_context()
    if SMTP_SECURITY == "ssl":
        server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30, context=ctx)
    else:
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30)
    with server:
        if SMTP_SECURITY == "starttls":
            server.starttls(context=ctx)
        if SMTP_USER:
            server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(msg)


# ---------- 주기적 확인 ----------
def run_once() -> int:
    """진행 중 회차를 한 번 훑어서 보내지 않은 알림을 발송한다. 보낸 메일 수를 돌려준다."""
    if not _lock.acquire(blocking=False):
        return 0
    sent_mails, errors = 0, []
    try:
        now = kst_now()
        with SessionLocal() as s:
            pours = list(s.scalars(select(Pour).options(selectinload(Pour.tests), selectinload(Pour.exclusions))
                                   .order_by(Pour.id)))
            for p in pours:
                to = recipients(p)
                if not to or p.start is None or not (0 <= (now - p.start).days < ACTIVE_DAYS):
                    continue
                try:
                    pred = maturity.predict(engine, p, pours)
                except maturity.PredictionError:
                    continue
                sent = (json.loads(p.notice) if p.notice else {}).get("sent", {})
                todo = [a for a in alerts_for(p, pred, now) if a["key"] not in sent]
                if not todo:
                    continue
                subject, body = compose(p, pred, todo)
                try:
                    send_mail(to, subject, body)
                except Exception as e:   # 이 회차는 기록하지 않음 → 다음 확인 때 다시 시도
                    errors.append(f"{p.name}: {type(e).__name__}: {e}")
                    continue
                save_notice(p, [a["key"] for a in todo], {m["key"]: m["expected"] for m in pred["milestones"]}, auto=True)
                s.commit()
                sent_mails += 1
                status["last_sent"] = kst_now()
                audit.write(login_id="system", ip=None, action="알림 메일 자동 발송", method="SMTP",
                            path=f"/api/pours/{p.id}/notice", status=200,
                            detail=json.dumps({"to": to, "keys": [a["key"] for a in todo], "subject": subject},
                                              ensure_ascii=False))
    except Exception as e:
        errors.append(f"{type(e).__name__}: {e}")
    finally:
        status["last_run"] = kst_now()
        status["last_error"] = " / ".join(errors)[:500] or None
        status["sent_count"] += sent_mails
        if errors:
            print(f"[notify] 발송 실패: {status['last_error']}", flush=True)
        _lock.release()
    return sent_mails


def _loop() -> None:
    time.sleep(30)   # 서버가 다 켜진 뒤 시작
    while True:
        run_once()
        time.sleep(max(1.0, NOTIFY_INTERVAL_MIN) * 60)


def start() -> None:
    """서버 시작 시 부른다. SMTP 설정이 있으면 백그라운드에서 주기적으로 확인한다."""
    if ENABLED:
        threading.Thread(target=_loop, name="notify", daemon=True).start()
        print(f"[notify] 자동 발송 켜짐: {SMTP_HOST}:{SMTP_PORT} ({SMTP_SECURITY}), {NOTIFY_INTERVAL_MIN:g}분마다 확인", flush=True)
    else:
        print("[notify] SMTP_HOST 가 없어 자동 발송은 꺼져 있습니다 (화면에서 메일 초안만 사용).", flush=True)
