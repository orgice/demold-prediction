"""탈형 상담 에이전트.

동작 (강의 Day 5 '에이전트 루프'를 직접 구현):
  1. 사용자 질문 + 쓸 수 있는 도구 목록을 LLM에 보낸다
  2. LLM이 "이 도구를 이 인자로 불러 달라"고 답하면 (tool_calls)
  3. 우리 코드가 그 도구를 실행하고, 결과를 대화에 붙여 다시 LLM에 보낸다
  4. LLM이 더 부를 도구가 없다고 하면 그 답을 최종 답변으로 돌려준다

LLM은 계산하지 않는다. 강도·해체 시각은 모두 maturity.py(적산온도 모델)가 계산하고,
LLM은 질문을 이해해 알맞은 도구를 고르고 결과를 사람 말로 설명하는 역할만 한다.
"""
import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from . import guideline, maturity
from .db import engine
from .models import Pour

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "").rstrip("/")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "qwen")
MAX_STEPS = 6          # 무한 반복 방지: LLM 호출은 질문당 최대 6번
HISTORY_LIMIT = 10     # 이전 대화는 최근 10개 메시지만 보낸다 (토큰 절약)


class AgentError(RuntimeError):
    pass


# ---------------------------------------------------------------- 도구 (실제 실행되는 함수)

def _all_pours(s: Session) -> list[Pour]:
    return list(s.scalars(select(Pour).options(selectinload(Pour.tests)).order_by(Pour.id)))


def _fmt(t) -> str | None:
    return None if t is None else pd.Timestamp(t).strftime("%Y-%m-%d %H:%M")


def tool_list_pours(s: Session) -> dict:
    return {"pours": [{
        "pour_id": p.id, "name": p.name, "site": p.site,
        "pour_start": _fmt(p.start),
        "start_source": "확정 입력값" if p.pour_start else ("측압 자동 추정" if p.detected_start else "없음"),
        "design_strength_mpa": p.design_strength,
        "strength_tests": len(p.tests),
    } for p in _all_pours(s)]}


def tool_get_prediction(s: Session, pour_id: int, as_of: str | None = None) -> dict:
    pours = _all_pours(s)
    p = next((x for x in pours if x.id == pour_id), None)
    if p is None:
        return {"error": f"pour_id {pour_id} 회차가 없습니다. list_pours 로 확인하세요."}
    try:
        r = maturity.predict(engine, p, pours, datetime.fromisoformat(as_of) if as_of else None)
    except maturity.PredictionError as e:
        return {"error": str(e)}
    return {
        "pour_id": p.id, "name": p.name,
        "pour_start": _fmt(r["start"]), "as_of": _fmt(r["as_of"]), "sensor_data_until": _fmt(r["data_end"]),
        "current_strength_mpa": r["current_strength"],
        "current_range_90pct_mpa": r["current_range"],
        "strength_28d_mpa": r["strength_28d"],
        "design_ratio_28d": r["design_ratio_28d"],
        "calibrated_with_specimens": r["model"]["calibrated"],
        "milestones": [{
            "label": m["label"],
            "reached_now": m["reached_at_as_of"],
            "expected": _fmt(m["expected"]),
            "conservative": _fmt(m["conservative"]),
            "observed_by_specimen": _fmt(m["observed"]),
        } for m in r["milestones"]],
        "note": "expected=예상 시각, conservative=90% 범위 하한 기준 보수적 시각. "
                "미래 온도는 직전 24시간 패턴 반복 가정.",
    }


def tool_get_temperature_summary(s: Session, pour_id: int, hours: int = 24, until: str | None = None) -> dict:
    p = next((x for x in _all_pours(s) if x.id == pour_id), None)
    if p is None:
        return {"error": f"pour_id {pour_id} 회차가 없습니다."}
    if p.start is None:
        return {"error": "타설 시작 시각이 없습니다."}
    T = maturity.temperature(engine, p.sensor_list, p.start, p.start + timedelta(days=60)).dropna()
    if T.empty:
        return {"error": "타설 이후 온도 데이터가 없습니다."}
    hours = max(1, min(int(hours), 24 * 14))
    end = min(pd.Timestamp(until), T.index.max()) if until else T.index.max()
    recent = T[(T.index > end - timedelta(hours=hours)) & (T.index <= end)]
    if recent.empty:
        return {"error": f"{_fmt(end)} 이전 {hours}시간에는 온도 데이터가 없습니다. "
                         f"데이터 범위: {_fmt(T.index.min())} ~ {_fmt(T.index.max())}"}
    return {
        "pour_id": p.id, "name": p.name, "sensors": p.sensor_list,
        "period": f"{_fmt(recent.index.min())} ~ {_fmt(recent.index.max())}",
        "inner_temp_now_c": round(float(recent.iloc[-1]), 1),
        "inner_temp_min_c": round(float(recent.min()), 1),
        "inner_temp_max_c": round(float(recent.max()), 1),
        "inner_temp_mean_c": round(float(recent.mean()), 1),
    }


def tool_search_guideline(s: Session, query: str, k: int = 4) -> dict:
    hits = guideline.search(query, k=max(1, min(int(k), 6)))
    if not hits:
        return {"results": [], "note": "가이드라인에서 관련 내용을 찾지 못했습니다."}
    return {"source": hits[0]["source"], "results": [{
        "pages": "p." + "-".join(dict.fromkeys([h["pages"][0], h["pages"][-1]])) if h["pages"] else "",
        "section": h["section"], "score": h["score"], "text": h["text"],
    } for h in hits], "note": "score 는 키워드 일치 점수(높을수록 관련). 내용이 질문과 맞지 않으면 근거로 쓰지 말 것."}


# LLM에게 보내는 '도구 설명서'. LLM은 함수 본문을 못 보고 이 설명만 보고 고른다.
TOOLS = [
    {"type": "function", "function": {
        "name": "list_pours",
        "description": "등록된 타설 회차 목록(pour_id, 이름, 타설 시작 시각, 설계기준강도, 공시체 시험 수)을 조회한다. "
                       "사용자가 '3회차', '테스트시험'처럼 이름으로 말하면 이것으로 pour_id 를 먼저 찾는다.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "get_prediction",
        "description": "한 회차의 현재 압축강도 예측, 28일 강도, 벽체 해체(5 MPa)·슬래브 해체(14 MPa)·설계기준강도 "
                       "도달 예상 시각과 보수적 시각을 조회한다. 강도·해체 시점 질문에는 반드시 이 도구를 쓴다.",
        "parameters": {"type": "object", "properties": {
            "pour_id": {"type": "integer", "description": "타설 회차 ID (list_pours 로 확인)"},
            "as_of": {"type": "string", "description": "선택. 'YYYY-MM-DDTHH:MM' 형식의 기준 시각. "
                                                      "'그때 예측했다면'을 물을 때만 쓴다. 생략하면 최신 데이터 기준."},
        }, "required": ["pour_id"]},
    }},
    {"type": "function", "function": {
        "name": "get_temperature_summary",
        "description": "한 회차 센서들의 콘크리트 내부온도(마지막 값·최저·최고·평균)를 조회한다. "
                       "온도나 양생 상태, 왜 강도가 빨리/늦게 오르는지 물을 때 쓴다. "
                       "특정 시점(예: 해체 예상 시각) 무렵을 보려면 until 에 그 시각을 넣는다.",
        "parameters": {"type": "object", "properties": {
            "pour_id": {"type": "integer"},
            "hours": {"type": "integer", "description": "until 이전 몇 시간을 볼지 (기본 24)"},
            "until": {"type": "string", "description": "선택. 'YYYY-MM-DDTHH:MM'. 이 시각까지의 구간을 본다. "
                                                     "생략하면 가장 최근 데이터까지."},
        }, "required": ["pour_id"]},
    }},
    {"type": "function", "function": {
        "name": "search_guideline",
        "description": "'거푸집 및 동바리 해체 가이드라인(2023)' 문서에서 관련 내용을 검색한다. "
                       "해체 기준 강도, 존치기간, 해체 순서·절차, 안전 수칙, 책임자 역할, 체크리스트 등 "
                       "규정·절차 질문에 쓴다. 특정 회차의 데이터(강도·시각·온도)를 물을 때는 쓰지 않는다.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "검색어. 핵심 단어 위주 (예: '슬래브 거푸집 해체 압축강도')"},
            "k": {"type": "integer", "description": "가져올 조각 수 (기본 4)"},
        }, "required": ["query"]},
    }},
]
TOOL_FUNCS = {
    "list_pours": tool_list_pours,
    "get_prediction": tool_get_prediction,
    "get_temperature_summary": tool_get_temperature_summary,
    "search_guideline": tool_search_guideline,
}


def system_prompt() -> str:
    now = datetime.utcnow() + timedelta(hours=9)
    return f"""당신은 '탈형 상담 에이전트'입니다. 건설 현장 담당자에게 거푸집 해체 시점을 안내합니다.
현재 시각: {now:%Y-%m-%d %H:%M} (한국 시간)

## 행동 원칙
1. 강도·해체 시각·온도는 반드시 도구로 조회한 값만 말합니다. 직접 계산하거나 추측하지 않습니다.
2. 회차 이름만 들었으면 list_pours 로 pour_id 를 먼저 찾습니다.
3. 해체 시각은 '예상 시각'과 '보수적 시각'을 함께 알려 주고, 안전을 위해 보수적 시각을 권장합니다.
4. 도구 결과에 error 가 있거나 정보가 없으면 지어내지 말고 "확인할 수 없습니다"라고 말한 뒤 이유를 알려 줍니다.
5. 이미 지난 시각이면 "이미 도달했습니다"처럼 현재 시각 기준으로 말합니다.
6. 해체 기준: 벽체 5 MPa, 슬래브 14 MPa (KCS 14 20 12). 최종 판단은 현장 책임자가 한다는 점을 필요하면 덧붙입니다.
7. 규정·절차·기준 질문은 search_guideline 으로 찾은 내용만 근거로 답하고, 답 끝에 `출처: 해체 가이드라인 p.N` 을 붙입니다.
   검색 결과에 답이 없으면 "가이드라인에서 확인할 수 없습니다"라고 말하고 일반 상식으로 채우지 않습니다.
8. 한국어로 3~6문장, 결론을 먼저 말합니다. 시각은 '11월 7일 01:00'처럼 씁니다.
9. 탈형·콘크리트 강도·센서·해체 규정과 관계없는 질문에는 도구를 쓰지 않고, 이 서비스의 범위를 짧게 안내합니다."""


# ---------------------------------------------------------------- LLM 호출

def call_llm(messages: list[dict]) -> dict:
    if not LLM_BASE_URL or not LLM_API_KEY:
        raise AgentError("LLM_BASE_URL / LLM_API_KEY 가 설정되지 않았습니다. webapp/.env 를 확인하세요.")
    body = json.dumps({
        "model": LLM_MODEL, "messages": messages, "tools": TOOLS,
        "temperature": 0, "max_tokens": 800,
        "chat_template_kwargs": {"enable_thinking": False},   # 생각 과정 끔 → 응답 약 4배 빠름
    }).encode()
    req = urllib.request.Request(f"{LLM_BASE_URL}/chat/completions", data=body, headers={
        "Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json",
        # 서버 앞단(Cloudflare)이 파이썬 기본 User-Agent 를 봇으로 보고 403(1010)으로 막는다
        "User-Agent": "demold-assistant/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=90) as res:
            return json.loads(res.read())["choices"][0]["message"]
    except urllib.error.HTTPError as e:
        raise AgentError(f"LLM 서버 오류 ({e.code})") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise AgentError("LLM 서버에 연결할 수 없습니다.") from e


# ---------------------------------------------------------------- 에이전트 루프

def run_agent(s: Session, question: str, history: list[dict]) -> dict:
    messages = [{"role": "system", "content": system_prompt()}]
    messages += [{"role": m["role"], "content": m["content"]} for m in history[-HISTORY_LIMIT:]
                 if m.get("role") in ("user", "assistant") and m.get("content")]
    messages.append({"role": "user", "content": question})
    steps = []  # 화면에 보여 줄 도구 호출 기록

    for _ in range(MAX_STEPS):
        reply = call_llm(messages)                       # ① LLM에게 묻는다
        messages.append(reply)
        calls = reply.get("tool_calls") or []
        if not calls:                                    # ② 부를 도구가 없으면 끝
            return {"answer": (reply.get("content") or "").strip(), "steps": steps}

        for call in calls:                               # ③ 요청한 도구를 우리가 실행
            name = call["function"]["name"]
            try:
                args = json.loads(call["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            func = TOOL_FUNCS.get(name)
            try:
                result = func(s, **args) if func else {"error": f"없는 도구: {name}"}
            except TypeError as e:                       # 인자를 잘못 준 경우
                result = {"error": f"인자 오류: {e}"}
            steps.append({"tool": name, "args": args, "ok": "error" not in result})
            messages.append({                            # ④ 결과를 대화에 붙인다 (tool_call_id 로 짝 맞춤)
                "role": "tool", "tool_call_id": call["id"],
                "content": json.dumps(result, ensure_ascii=False, default=str),
            })

    return {"answer": "질문을 처리하는 데 단계가 너무 많이 필요합니다. 질문을 나눠서 다시 물어봐 주세요.",
            "steps": steps}
