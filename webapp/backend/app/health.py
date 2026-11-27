"""장애 알림: 백그라운드 작업이 계속 실패하면 관리자에게 메일을 보낸다.

감시하는 작업 (각 모듈이 끝날 때마다 report()로 성공·실패를 알린다)
    delta    센서 데이터 자동 수집 (delta_sync.py, 10분마다)
    weather  기상청 단기예보 받기 (weather.py, 1시간마다, 진행 중인 회차의 현장 위치마다)
    climate  평년 기온 표 만들기 (weather.py, 관측소마다 한 번)

규칙
    - 한 번 실패로는 보내지 않는다. 처음 실패한 뒤 ALERT_AFTER_MIN 분 넘게 계속 실패하면 보낸다
      (잠깐의 네트워크 오류로 메일이 쏟아지지 않게).
    - 계속 실패하면 ALERT_REPEAT_H 시간마다 다시 알린다.
    - 알린 뒤 다시 성공하면 '정상으로 돌아왔다'는 메일을 보낸다.
    - 받는 사람: .env 의 ALERT_EMAILS (쉼표 구분). 비우면 보내는 주소(SMTP_FROM)로 보낸다.
    - SMTP 설정이 없으면 메일 없이 로그만 남긴다.
상태는 메모리에만 둔다 (서버를 다시 켜면 처음부터 다시 센다).

서버 전체가 꺼지면 이 코드도 같이 꺼지므로 알릴 수 없다. 그건 외부 감시 서비스(예: 사이트 주소를 주기적으로 여는 무료 서비스)로 본다.
"""
import threading
from datetime import datetime, timedelta

from .config import ALERT_AFTER_MIN, ALERT_EMAILS, ALERT_REPEAT_H, APP_URL, SMTP_FROM, SMTP_HOST
from .security import kst_now

LABEL = {"delta": "센서 데이터 자동 수집", "weather": "기상청 단기예보 받기", "climate": "평년 기온 표 만들기"}

_state: dict[str, dict] = {}   # 작업 → {first_fail, last_error, fails, alerted_at}
_lock = threading.Lock()


def recipients() -> list[str]:
    return ALERT_EMAILS or ([SMTP_FROM] if SMTP_FROM else [])


def report(job: str, ok: bool, error: str | None = None, now: datetime | None = None) -> str | None:
    """작업 결과를 알린다. 메일을 보냈으면 그 종류('alert'·'repeat'·'recovered'), 아니면 None."""
    now = now or kst_now()
    with _lock:
        s = _state.setdefault(job, {"first_fail": None, "last_error": None, "fails": 0, "alerted_at": None})
        since, fails = s["first_fail"], s["fails"]
        if ok:
            kind = "recovered" if s["alerted_at"] is not None else None
            s.update(first_fail=None, last_error=None, fails=0, alerted_at=None)
            err = None
        else:
            s["fails"] += 1
            s["last_error"] = (error or "알 수 없는 오류")[:500]
            s["first_fail"] = s["first_fail"] or now
            since, fails, err = s["first_fail"], s["fails"], s["last_error"]
            if now - since < timedelta(minutes=ALERT_AFTER_MIN):
                kind = None
            elif s["alerted_at"] is None:
                kind = "alert"
            elif now - s["alerted_at"] >= timedelta(hours=ALERT_REPEAT_H):
                kind = "repeat"
            else:
                kind = None
            if kind:
                s["alerted_at"] = now
    if kind:   # 메일은 잠금 밖에서 (SMTP 가 느려도 다른 작업의 보고를 막지 않게)
        _send(job, kind, since, fails, err, now)
    return kind


def status() -> dict:
    """지금 실패 중인 작업 (화면·점검용)."""
    with _lock:
        return {k: {**v, "label": LABEL.get(k, k)} for k, v in _state.items() if v["fails"]}


def _fmt(t: datetime | None) -> str:
    return t.strftime("%Y-%m-%d %H:%M") if t else "-"


def _send(job: str, kind: str, since: datetime | None, fails: int, error: str | None, now: datetime) -> None:
    name = LABEL.get(job, job)
    if kind == "recovered":
        subject = f"[FormCast] 복구: {name}"
        body = (f"{name}이(가) 정상으로 돌아왔습니다.\n\n"
                f"- 실패 시작: {_fmt(since)}\n- 복구: {_fmt(now)}\n- 그동안 실패 횟수: {fails}번\n\n{APP_URL}\n")
    else:
        subject = f"[FormCast] 장애{' (계속)' if kind == 'repeat' else ''}: {name} 실패"
        body = (f"{name}이(가) {_fmt(since)}부터 계속 실패하고 있습니다.\n\n"
                f"- 실패 횟수: {fails}번\n- 마지막 오류: {error}\n- 확인 시각: {_fmt(now)}\n\n"
                "서버 로그에서 자세한 내용을 볼 수 있습니다:\n"
                "  sudo docker compose -p demold_public logs backend --since 2h\n\n"
                f"고쳐질 때까지 {ALERT_REPEAT_H}시간마다 다시 알리고, 복구되면 알려 드립니다.\n{APP_URL}\n")
    print(f"[health] {subject} — {error or ''}", flush=True)
    to = recipients()
    if not SMTP_HOST or not to:
        return
    try:
        from .notify import send_mail   # notify 가 maturity 등을 불러오므로 여기서 늦게 부른다
        send_mail(to, subject, body)
    except Exception as e:   # 메일까지 실패하면 로그만 남긴다
        print(f"[health] 장애 알림 메일 발송 실패: {type(e).__name__}: {e}", flush=True)
