"""해체 가이드라인 검색 (RAG 의 Retrieval 단계).

AI 상담에서 "가이드라인에 뭐라고 나와 있어?" 같은 질문에 쓰는 문서 검색이다.
색인 파일(조각 + 임베딩 벡터)에서 질문과 관련 있는 조각을 찾아 AI에게 근거로 넘긴다.
색인은 scripts/build_guideline_index.py 로 만들며, 아래 순서로 먼저 있는 것을 쓴다.
  ① app/data/guideline_chunks.json : 원문 PDF 색인. 원문이 재배포 금지라 저장소에 없고 각자 만든다 (더 자세함)
  ② knowledge/summary_index.json  : 팀 요약본(knowledge/removal_summary.md) 색인. 저장소에 들어 있다

하이브리드 검색 = 두 검색의 순위를 합친다.
  ① BM25 키워드 검색 (직접 구현, 강의 Day 4): '14 MPa', 'KCS' 처럼 정확한 숫자·용어에 강하다.
     한국어는 '해체시기'·'해체 시기'처럼 띄어쓰기가 흔들리므로 단어 그대로 + 두 글자 조각(bigram)도 색인한다.
  ② 임베딩 의미 검색 (embedding.py, 팀 서버 qwen-embedding): '탈형'↔'해체', '바닥'↔'슬래브'처럼
     단어가 달라도 뜻이 비슷한 조각을 찾는다. 조각 벡터는 색인 파일에 미리 저장되어 있다.
  두 점수는 단위가 달라 그대로 더할 수 없으므로 '순위'로 합친다 (RRF: 가중치/(60+순위) 의 합).
  키워드 쪽 가중치는 0.5: 평가(scripts/eval_guideline_search.py)에서 1위 적중·MRR 이 가장 좋았다.
임베딩 서버가 꺼져 있거나 늦으면 ①만으로 검색한다 (상담 기능은 멈추지 않음).
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path

from . import embedding

PDF_INDEX = Path(__file__).parent / "data" / "guideline_chunks.json"
SUMMARY_INDEX = Path(__file__).parents[1] / "knowledge" / "summary_index.json"
DATA = PDF_INDEX if PDF_INDEX.exists() else SUMMARY_INDEX
K1, B = 1.5, 0.75   # BM25 표준 값: K1 = 같은 단어 반복의 효과 상한, B = 문서 길이 보정 정도
RRF_K = 60          # RRF 상수 (표준값). 클수록 상위 몇 개에 덜 치우친다
KEYWORD_WEIGHT = 0.5  # 순위 합칠 때 키워드 검색 비중 (의미 검색은 1.0). 1.0 이면 키워드 잡음이 정답을 밀어냄
WORD = re.compile(r"[0-9A-Za-z]+(?:\.[0-9]+)*|[가-힣]+")   # 숫자·영문 단어, 또는 한글 단어


def tokenize(text: str) -> list[str]:
    """문장을 검색용 단어로 자른다. 예: '해체시기' → ['해체시기', '해체', '체시', '시기']."""
    tokens = []
    for w in WORD.findall(text.lower()):
        tokens.append(w)
        if re.fullmatch(r"[가-힣]+", w) and len(w) > 2:
            tokens += [w[i:i + 2] for i in range(len(w) - 1)]
    return tokens


@lru_cache(maxsize=1)
def _index():
    """색인을 한 번만 만들어 기억해 둔다 (단어별 등장 횟수, 문서 길이, 희귀도 idf)."""
    data = json.loads(DATA.read_text())
    chunks = data["chunks"]
    docs = [Counter(tokenize(f"{c['section']} {c['text']}")) for c in chunks]
    lengths = [sum(d.values()) for d in docs]
    df = Counter(t for d in docs for t in d)
    n = len(docs)
    # idf: 적은 문서에만 나오는 단어일수록 점수가 크다 (흔한 단어는 덜 중요)
    idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
    vecs = [c.pop("vec") for c in chunks] if all("vec" in c for c in chunks) else None
    return data["source"], chunks, docs, lengths, sum(lengths) / n, idf, vecs


def bm25(query: str) -> list[tuple[float, int]]:
    """키워드 검색: (점수, 조각 번호) 를 점수 높은 순으로. 일치하는 단어가 없는 조각은 빠진다."""
    _, chunks, docs, lengths, avg_len, idf, _ = _index()
    q = Counter(tokenize(query))
    scored = []
    for i, d in enumerate(docs):
        s = 0.0
        for t, qf in q.items():
            f = d.get(t)
            if f:
                # BM25 점수: 희귀한 단어가 이 조각에 자주 나올수록 높고, 조각이 길면 조금 깎는다
                s += idf[t] * f * (K1 + 1) / (f + K1 * (1 - B + B * lengths[i] / avg_len))
        if s > 0:
            scored.append((s, i))
    scored.sort(reverse=True)
    return scored


def dense(query: str) -> list[tuple[float, int]] | None:
    """의미 검색: (코사인 유사도, 조각 번호) 를 높은 순으로. 벡터가 없거나 서버 실패면 None."""
    vecs = _index()[6]
    if not vecs:
        return None
    try:
        q = embedding.embed_query(query)
    except embedding.EmbeddingError:
        return None
    return sorted(((embedding.dot(q, v), i) for i, v in enumerate(vecs)), reverse=True)


def search(query: str, k: int = 4, mode: str = "hybrid") -> list[dict]:
    """질문과 가장 관련 있는 가이드라인 조각 k개. mode: hybrid(기본) · bm25 · dense (평가 비교용)."""
    if not DATA.exists():   # 인덱스 미생성 (scripts/build_guideline_index.py)
        return []
    source, chunks = _index()[:2]
    kw = bm25(query) if mode != "dense" else []
    sem = dense(query) if mode != "bm25" else None
    method = "hybrid" if kw and sem else "dense" if sem else "bm25"

    # 순위 합치기 (RRF). 한쪽 검색에만 나온 조각도 그 순위만큼 점수를 받는다
    fused: dict[int, float] = {}
    for weight, ranked in ((KEYWORD_WEIGHT if sem else 1.0, kw), (1.0, sem or [])):
        for rank, (_, i) in enumerate(ranked, start=1):
            fused[i] = fused.get(i, 0.0) + weight / (RRF_K + rank)
    kw_score = {i: s for s, i in kw}
    cos = {i: s for s, i in sem or []}
    top = sorted(fused.items(), key=lambda x: -x[1])[:k]
    return [{**chunks[i], "source": source, "method": method, "score": round(f * 100, 2),
             "keyword": round(kw_score.get(i, 0.0), 2), "similarity": round(cos[i], 3) if i in cos else None}
            for i, f in top]
