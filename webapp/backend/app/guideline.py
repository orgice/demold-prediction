"""해체 가이드라인 검색 (RAG 의 Retrieval 단계).

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
K1, B = 1.5, 0.75
WORD = re.compile(r"[0-9A-Za-z]+(?:\.[0-9]+)*|[가-힣]+")


def tokenize(text: str) -> list[str]:
    tokens = []
    for w in WORD.findall(text.lower()):
        tokens.append(w)
        if re.fullmatch(r"[가-힣]+", w) and len(w) > 2:
            tokens += [w[i:i + 2] for i in range(len(w) - 1)]
    return tokens


@lru_cache(maxsize=1)
def _index():
    data = json.loads(DATA.read_text())
    chunks = data["chunks"]
    docs = [Counter(tokenize(f"{c['section']} {c['text']}")) for c in chunks]
    lengths = [sum(d.values()) for d in docs]
    df = Counter(t for d in docs for t in d)
    n = len(docs)
    idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
    return data["source"], chunks, docs, lengths, sum(lengths) / n, idf


def search(query: str, k: int = 4) -> list[dict]:
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
                s += idf[t] * f * (K1 + 1) / (f + K1 * (1 - B + B * lengths[i] / avg_len))
        if s > 0:
            scored.append((s, i))
    scored.sort(reverse=True)
    return [{**chunks[i], "source": source, "score": round(s, 2)} for s, i in scored[:k]]
