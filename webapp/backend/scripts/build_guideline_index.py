"""해체 가이드라인 PDF → 검색용 조각(chunk) JSON.  (RAG 인덱싱: Load → Split → Store)

PDF 를 읽는 PyMuPDF 는 백엔드 컨테이너에 없으므로, 분석용 가상환경에서 한 번만 실행한다.
    pip install pymupdf
    python webapp/backend/scripts/build_guideline_index.py "<가이드라인 PDF 경로>"
결과: webapp/backend/app/data/guideline_chunks.json (컨테이너는 이 파일만 읽는다)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parents[3]
PDF = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "private_data" / "거푸집 및 동바리 해체 가이드라인.pdf"
OUT = Path(__file__).resolve().parents[1] / "app" / "data" / "guideline_chunks.json"
SOURCE = "거푸집 및 동바리 해체 가이드라인 (2023.1)"

CHUNK_SIZE = 700      # 조각 최대 글자 수 (강의 권장 600~900)
OVERLAP_LINES = 2     # 앞 조각의 마지막 2줄을 다음 조각 앞에 겹쳐 문맥이 끊기지 않게
PUA = re.compile(r"[-]")                       # 수식 기호가 깨진 글자
SECTION = re.compile(r"^(\d+\.\d+(?:\.\d+)?)\s+\S")         # 2.1 / 2.1.1 같은 절 제목
CHAPTER = re.compile(r"^제\s*(\d+)\s*장\s*(.+)")


# PDF 에서 글자를 뽑으면 표의 칸 구조가 사라져 숫자가 어느 칸 것인지 알 수 없다.
# 핵심 표는 원문(9~10쪽)을 보고 문장으로 풀어 쓴 조각을 따로 넣는다 (강의 Day 3: 표는 문장으로 변환).
TABLE_NOTES = [
    {"chapter": "제2장 거푸집 및 동바리 존치기간", "section": "표 2.1.1 (문장 정리)", "pages": ["9"],
     "text": "표 2.1.1 콘크리트의 압축강도를 시험할 경우 거푸집 널의 해체 시기.\n"
             "- 기초, 보, 기둥, 벽 등의 측면 거푸집: 압축강도 5 MPa 이상이면 해체 가능. "
             "내구성이 중요한 구조물은 10 MPa 이상.\n"
             "- 슬래브 및 보의 밑면, 아치 내면 거푸집 (단층구조): 설계기준압축강도의 2/3배 이상이고, 최소 14 MPa 이상.\n"
             "- 슬래브 및 보의 밑면, 아치 내면 거푸집 (다층구조): 설계기준압축강도 이상. "
             "필러 동바리 구조를 쓰면 구조계산으로 기간을 단축할 수 있으나 이 경우도 최소 14 MPa 이상.\n"
             "- 강도 확인은 현장의 가장 불리한 조건과 같은 상태로 양생한 현장양생 공시체의 압축강도 시험으로 한다.\n"
             "검색어: 거푸집 해체 기준 강도, 벽체 탈형 5MPa, 슬래브 탈형 14MPa, 해체 가능 강도, 몇 MPa"},
    {"chapter": "제2장 거푸집 및 동바리 존치기간", "section": "표 2.1.2 (문장 정리)", "pages": ["10"],
     "text": "표 2.1.2 콘크리트의 압축강도를 시험하지 않을 경우 거푸집 널의 해체 시기 (기초, 보, 기둥 및 벽의 측면).\n"
             "거푸집 널 존치기간 중 평균기온이 10 ℃ 이상일 때만 적용하며, 재령은 콘크리트 타설 완료 시점부터 센다.\n"
             "- 평균기온 20 ℃ 이상: 조강포틀랜드 시멘트 2일 / 보통포틀랜드 시멘트·고로 슬래그 시멘트(1종)·"
             "포틀랜드포졸란시멘트(1종)·플라이 애시 시멘트(1종) 4일 / 고로 슬래그 시멘트(2종)·"
             "포틀랜드포졸란시멘트(2종)·플라이 애시 시멘트(2종) 5일.\n"
             "- 평균기온 10 ℃ 이상 20 ℃ 미만: 조강포틀랜드 시멘트 3일 / 보통포틀랜드 시멘트·고로 슬래그 시멘트(1종)·"
             "포틀랜드포졸란시멘트(1종)·플라이 애시 시멘트(1종) 6일 / 고로 슬래그 시멘트(2종)·"
             "포틀랜드포졸란시멘트(2종)·플라이 애시 시멘트(2종) 8일.\n"
             "- 평균기온 10 ℃ 미만이면 이 표를 쓸 수 없고 압축강도 시험(5 MPa 이상)으로 확인해야 한다.\n"
             "검색어: 벽체 거푸집 해체, 압축강도 시험 없이, 시험 안 하고, 며칠 후 해체, 존치기간 일수, 재령 일수, 시멘트 종류별 해체 시기"},
]


def page_lines(page) -> tuple[str | None, list[str]]:
    """PDF 한 쪽의 글자를 줄 단위로 뽑고, 머리글에서 쪽 번호를 찾는다. 반환: (쪽 번호, 본문 줄들)."""
    lines = [PUA.sub("", l).strip() for l in page.get_text().splitlines()]
    lines = [l for l in lines if l]
    page_no = None
    # 각 쪽 위 머리글: "거푸집 및 동바리 해체 가이드라인" 또는 "제N장 …" + 쪽 번호
    if len(lines) >= 2 and lines[1].isdigit() and (lines[0].startswith("거푸집 및 동바리") or CHAPTER.match(lines[0])):
        page_no, lines = lines[1], lines[2:]
    return page_no, lines


def build():
    """PDF 전체를 절(2.1, 2.1.1 …) 단위로, 길면 700자 안팎으로 잘라 JSON으로 저장한다."""
    doc = fitz.open(PDF)
    chunks, buf, chapter, section = [], [], "", ""
    buf_pages: list[str] = []

    def flush():
        """지금까지 모은 줄들(buf)을 조각 하나로 저장 (40자 미만은 버림)."""
        text = "\n".join(l for _, l in buf).strip()
        if len(text) >= 40:
            pages = sorted({p for p, _ in buf if p}, key=int)
            chunks.append({"id": len(chunks), "chapter": chapter, "section": section,
                           "pages": pages, "text": text})

    for page in doc:
        page_no, lines = page_lines(page)
        if page_no is None:          # 표지·목차·장 표지는 건너뜀
            continue
        for line in lines:
            m = CHAPTER.match(line)
            if m and len(line) < 40:
                chapter = f"제{m.group(1)}장 {m.group(2).strip()}"
                continue
            starts_section = bool(SECTION.match(line)) and len(line) < 60
            size = sum(len(l) + 1 for _, l in buf)
            if buf and (starts_section or size + len(line) > CHUNK_SIZE):
                flush()
                buf = [] if starts_section else buf[-OVERLAP_LINES:]
            if starts_section:
                section = line
            buf.append((page_no, line))
    if buf:
        flush()
    for note in TABLE_NOTES:
        chunks.append({"id": len(chunks), **note})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source": SOURCE, "chunks": chunks}, ensure_ascii=False, indent=1))
    print(f"{len(chunks)} chunks → {OUT}")


if __name__ == "__main__":
    build()
