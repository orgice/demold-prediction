"""해체 가이드라인 검색 (RAG 의 Retrieval 단계).

AI 상담에서 "가이드라인에 뭐라고 나와 있어?" 같은 질문에 쓰는 문서 검색이다.
가이드라인 PDF를 조각(chunk)으로 나눈 파일(data/guideline_chunks.json)에서
질문과 관련 있는 조각을 찾아 AI에게 근거로 넘긴다.
이 파일은 scripts/build_guideline_index.py 로 만들며, 없으면 검색 결과가 비어 있다.

BM25 키워드 검색을 직접 구현했다 (강의 Day 4). 팀 LLM 서버에는 임베딩 모델이 없어서
벡터 검색 대신 BM25 를 쓴다. 한국어는 '해체시기'·'해체 시기'처럼 띄어쓰기가 흔들리므로
단어 그대로 + 두 글자씩 자른 조각(bigram)을 함께 색인한다.
"""
import json
import math
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).parent / "data" / "guideline_chunks.json"
K1, B = 1.5, 0.75   # BM25 표준 값: K1 = 같은 단어 반복의 효과 상한, B = 문서 길이 보정 정도
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
    return data["source"], chunks, docs, lengths, sum(lengths) / n, idf


def search(query: str, k: int = 4) -> list[dict]:
    """질문과 가장 관련 있는 가이드라인 조각 k개를 점수 순으로 돌려준다."""
    if not DATA.exists():   # 인덱스 미생성 (scripts/build_guideline_index.py)
        return []
    source, chunks, docs, lengths, avg_len, idf = _index()
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
    return [{**chunks[i], "source": source, "score": round(s, 2)} for s, i in scored[:k]]
