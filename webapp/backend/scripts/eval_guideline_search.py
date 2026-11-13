"""가이드라인 검색 평가: 키워드(BM25) · 의미(임베딩) · 하이브리드를 같은 질문으로 비교한다.

질문은 현장에서 실제로 물어볼 법한 말투로 썼다 ('탈형', '바닥', '빠루' 등 문서와 다른 단어 포함).
정답은 그 질문의 답이 들어 있는 조각 번호(id)들이며, 이 중 하나라도 찾으면 맞힌 것으로 본다.
조각 번호는 build_guideline_index.py 가 같은 PDF 로 만든 색인 기준이다 (PDF·자르는 규칙이 바뀌면 다시 맞춰야 함).

    set -a; . webapp/.env; set +a
    python webapp/backend/scripts/eval_guideline_search.py
지표: 1위 적중(hit@1), 상위 4개 안 적중(hit@4, AI 에게 넘기는 개수), MRR(첫 정답 순위의 역수 평균, 1이 최고)
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import guideline  # noqa: E402

CASES = [
    ("바닥 탈형은 강도 몇부터 가능해?", {104, 14, 15, 94}),
    ("벽 거푸집 떼려면 몇 MPa 나와야 돼?", {104, 14, 15}),
    ("공시체 시험 안 하고 며칠 지나면 옆판 떼도 돼?", {105, 15, 16}),
    ("기온이 10도 밑이면 일수 기준으로 해체해도 되나?", {105}),
    ("동바리는 아래로 몇 개 층까지 남겨둬야 해?", {18, 19, 20, 71, 72}),
    ("해체 작업은 누가 최종 승인해?", {52, 35}),
    ("해체 작업자가 꼭 착용해야 하는 보호구는?", {50}),
    ("빠루 같은 해체 공구는 어떻게 점검해?", {48, 49}),
    ("유로폼 웨지핀은 어떤 순서로 빼?", {58, 60}),
    ("슬래브 밑 거푸집이랑 동바리 중에 뭘 먼저 빼?", {16, 65}),
    ("필러 동바리가 뭐야?", {6, 7, 17, 94}),
    ("거푸집 뗀 다음 콘크리트 면에 문제가 보이면 어떻게 해?", {66}),
    ("해체 들어가기 전에 확인할 체크리스트 알려줘", {87, 88}),
    ("감리는 해체 공사에서 뭘 확인해야 돼?", {79, 80, 81}),
    ("양생 중인 콘크리트 강도는 어떻게 예측해?", {31}),
    ("여러 층 구조면 슬래브는 설계강도까지 다 나와야 해?", {15, 104}),
    ("해체하는 곳이 어두운데 조명은 어떻게 해?", {47}),
    ("뜯어낸 자재는 어떻게 쌓아둬?", {68, 69, 44}),
]


def evaluate(mode: str) -> dict:
    hit1 = hit4 = rr = 0.0
    misses, t0 = [], time.time()
    for q, gold in CASES:
        ids = [h["id"] for h in guideline.search(q, k=4, mode=mode)]
        rank = next((r for r, i in enumerate(ids, 1) if i in gold), None)
        hit1 += rank == 1
        hit4 += rank is not None
        rr += 1 / rank if rank else 0
        if not rank:
            misses.append(q)
    n = len(CASES)
    return {"hit@1": hit1 / n, "hit@4": hit4 / n, "MRR": rr / n, "sec/질문": (time.time() - t0) / n, "misses": misses}


if __name__ == "__main__":
    if guideline.DATA != guideline.PDF_INDEX:
        sys.exit("이 평가는 원문 PDF 색인의 조각 번호 기준이다. app/data/guideline_chunks.json 을 먼저 만드세요.")
    print(f"질문 {len(CASES)}개\n")
    print(f"{'방식':<8}{'hit@1':>8}{'hit@4':>8}{'MRR':>8}{'초/질문':>9}")
    results = {m: evaluate(m) for m in ("bm25", "dense", "hybrid")}
    for m, r in results.items():
        print(f"{m:<8}{r['hit@1']:>8.0%}{r['hit@4']:>8.0%}{r['MRR']:>8.2f}{r['sec/질문']:>9.2f}")
    for m, r in results.items():
        if r["misses"]:
            print(f"\n[{m}] 상위 4개에서 못 찾은 질문:")
            for q in r["misses"]:
                print("  -", q)
