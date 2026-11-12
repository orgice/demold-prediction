"""문장 → 벡터 (임베딩). 하이브리드 검색의 '의미 검색' 쪽에 쓴다.

팀 서버(DGX Spark)의 공용 임베딩 모델(qwen-embedding = Qwen3-Embedding-0.6B, 1024차원)을
LLM 과 같은 주소·같은 API 키로 부른다. 문서 조각과 질문은 반드시 같은 모델로 바꿔야 서로 비교할 수 있다.

질문은 그대로 보낸다. Qwen3-Embedding 권장 방식대로 질문 앞에 할 일 설명(Instruct: …)을 붙여 봤지만
평가 질문 18개(scripts/eval_guideline_search.py)에서 오히려 크게 나빠졌다 (상위 4개 적중 56% → 지시문 없이 100%).
"""
import json
import math
import os
import urllib.error
import urllib.request

BASE_URL = os.environ.get("LLM_BASE_URL", "").rstrip("/")
API_KEY = os.environ.get("LLM_API_KEY", "")
MODEL = os.environ.get("EMBED_MODEL", "qwen-embedding")
TIMEOUT_S = 8          # 질문 임베딩이 이보다 늦으면 포기하고 키워드 검색만 쓴다


class EmbeddingError(RuntimeError):
    """임베딩 서버 설정이 없거나 호출에 실패했을 때."""


def _call(texts: list[str], timeout: float) -> list[list[float]]:
    if not BASE_URL or not API_KEY:
        raise EmbeddingError("LLM_BASE_URL / LLM_API_KEY 가 설정되지 않았습니다.")
    req = urllib.request.Request(f"{BASE_URL}/embeddings", data=json.dumps({"model": MODEL, "input": texts}).encode(),
                                 headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json",
                                          "User-Agent": "demold-assistant/0.1"})   # 파이썬 기본 UA 는 Cloudflare 가 막는다
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            data = json.loads(res.read())["data"]
    except urllib.error.HTTPError as e:
        raise EmbeddingError(f"임베딩 서버 오류 ({e.code})") from e
    except (OSError, KeyError, ValueError) as e:   # 연결 실패·시간 초과(URLError, socket.timeout 모두 OSError)
        raise EmbeddingError(f"임베딩 서버에 연결할 수 없습니다: {e}") from e
    return [normalize(d["embedding"]) for d in sorted(data, key=lambda d: d["index"])]


def normalize(v: list[float]) -> list[float]:
    """길이를 1로 맞춘다. 그러면 두 벡터의 내적(dot)이 곧 코사인 유사도가 된다."""
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def dot(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def embed_documents(texts: list[str], batch: int = 16) -> list[list[float]]:
    """문서 조각들 → 벡터 (색인 만들 때 한 번). 16개씩 나눠 보낸다."""
    out = []
    for i in range(0, len(texts), batch):
        out += _call(texts[i:i + batch], timeout=60)
    return out


def embed_query(query: str) -> list[float]:
    """질문 → 벡터 (질문마다). 늦거나 실패하면 EmbeddingError."""
    return _call([query], timeout=TIMEOUT_S)[0]
