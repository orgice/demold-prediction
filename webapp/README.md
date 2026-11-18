# 거푸집 탈형 시점 예측 웹앱

거푸집 센서(내부온도·측압·수분) 데이터로 콘크리트 압축강도를 예측하고,
벽체 해체(5 MPa)·슬래브 해체(14 MPa)·설계기준강도 도달 예상 시각을 보여주는 웹앱입니다.

```
frontend (React, :8080)  →  backend (FastAPI, :8000)  →  db (MariaDB, :3306)
```

## 1. 실행

필요한 것: [Docker Desktop](https://www.docker.com/products/docker-desktop/)

```bash
cd webapp
docker compose up -d --build          # 처음 한 번은 이미지 빌드로 몇 분 걸립니다
```

- 웹앱: http://localhost:8080
- API 문서(Swagger): http://localhost:8000/docs

### 첫 관리자 계정 만들기 (처음 한 번)

모든 화면과 API는 로그인해야 쓸 수 있습니다. 처음에는 계정이 없으므로 관리자를 하나 만듭니다.

```bash
docker compose exec backend python -m scripts.create_admin <ID> [이름]   # 비밀번호는 입력 창에서 두 번
```

또는 `.env`에 `ADMIN_ID`·`ADMIN_PASSWORD`를 넣고 띄우면, 사용자가 한 명도 없을 때 서버가 자동으로 만듭니다.
그 뒤 계정 추가·권한 변경은 화면의 **사용자 관리**(관리자 메뉴)에서 합니다.
관리자 비밀번호를 잊었을 때도 같은 스크립트를 실행하면 비밀번호가 재설정됩니다.

| 권한 | 할 수 있는 것 |
|---|---|
| 보기 | 모든 화면 조회, AI 상담 |
| 편집 | 보기 + 회차 등록·수정·삭제, 타설 시각·공시체·제외 구간 입력, CSV 업로드 |
| 관리자 | 편집 + 사용자 관리 |

각 사용자는 상단의 자기 이름을 눌러 **내 계정**에서 ID·이름·비밀번호를 바꿀 수 있습니다 (ID·비밀번호는 현재 비밀번호 확인, 비밀번호를 바꾸면 다른 기기의 로그인은 끊김).
관리자는 **사용자 관리 › 수정 › 새 비밀번호로 재설정**으로 다른 사람의 비밀번호를 바꿀 수 있습니다.

### HTTPS로 서비스하기 (실제 운영)

로컬 확인은 http://localhost:8080 으로 충분하지만, 다른 사람이 접속하는 서버는 반드시 HTTPS로 엽니다
(http면 비밀번호·로그인 쿠키가 네트워크에 그대로 보임).

1. `.env`에 `SITE_ADDRESS`를 넣습니다.
   - 도메인(예: `demold.example.com`): 도메인이 이 서버를 가리키고 80·443 포트가 열려 있으면 인증서를 자동으로 받고 갱신합니다.
   - 내부 IP(예: `192.168.0.10`): 자체 인증서로 암호화합니다. 브라우저가 처음에 경고를 띄웁니다.
2. HTTPS 앞단(caddy)까지 함께 켭니다.

```bash
docker compose -p demold_public --profile https up -d --build
```

http로 들어오면 https로 자동으로 넘기고, HTTPS로 들어온 로그인은 HTTPS 전용 쿠키(`Secure`)를 받습니다.
운영 서버에서는 8080·8000·3306 포트를 외부에 열지 마세요 (443·80만).

### 초기 데이터 넣기 (처음 한 번)

실제 데이터는 저장소에 없습니다. 데이터가 있다면:

1. `cp .env.example .env` 후 `SEED_SENSOR_DIR`에 센서 CSV 폴더(측압·수분, 하위 폴더 포함)를 지정
2. `backend/seed/pours.csv`, `backend/seed/strength.csv`를 만듭니다. 형식은 `*.example.csv` 참고 (예시 값은 가짜)
3. 실행:

```bash
docker compose exec backend python -m scripts.seed /seed/sensors
```

여러 번 실행해도 중복으로 들어가지 않습니다. 데이터 없이 띄워도 **데이터 업로드** 화면에서 CSV를 올려 쓸 수 있습니다.

### AI 상담 설정 (선택)

`.env`에 OpenAI 호환 LLM 서버를 넣습니다 (`/v1/chat/completions`, tool calling 지원 모델 필요).

```
LLM_BASE_URL=https://<your-llm-server>/v1
LLM_API_KEY=...
LLM_MODEL=...
EMBED_MODEL=qwen-embedding
```

해체 가이드라인 검색은 따로 준비하지 않아도 됩니다. 저장소에 든 팀 요약본 색인(`backend/knowledge/summary_index.json`)을 씁니다.
더 자세한 답이 필요하면 국토교통부 원문 PDF(국가건설기준센터 www.kcsc.re.kr, 재배포 금지라 저장소에 없음)로 색인을 만듭니다. 만들면 그 색인을 먼저 씁니다.
`pip install pymupdf && python backend/scripts/build_guideline_index.py "<PDF 경로>"` → `backend/app/data/guideline_chunks.json`
요약본(`backend/knowledge/removal_summary.md`)을 고쳤으면 `--summary` 로 요약 색인을 다시 만듭니다.

### 끄기 / 초기화

```bash
docker compose down        # 끄기 (데이터는 남음)
docker compose down -v     # DB까지 완전히 삭제
```

## 2. 화면

| 메뉴 | 내용 |
|---|---|
| **현재 공사** | 타설 후 28일이 지나지 않은 (진행 중인) 회차의 상세 화면 |
| **타설 이력** | 전체 회차별 현재 예측 강도와 5·14 MPa·설계강도 도달 예상 시각. `+ 새 타설 등록` |
| **AI 상담** | "3회차 슬래브 언제 떼도 돼?"처럼 물으면 LLM이 예측·온도·가이드라인 도구를 불러 답함 |
| 회차 › **강도 예측** | 예측 곡선(90% 범위), 해체 가능 예상 시각(예상·보수적), 내부온도. **기준 시각 슬라이더**로 "그 시각에 예측했다면"을 재현 |
| 회차 › **타설 시점 확인** | 타설일 측압 그래프. 자동 추정 시각 확인 후 실제 타설 시작·종료 입력 |
| 회차 › **공시체 결과** | 압축강도 시험 결과 입력·수정. 현장양생 결과가 들어가면 그 회차 예측이 보정됨 |
| 회차 › **설정** | 이름, 현장, 설계기준강도, 사용 센서 |
| **센서 데이터** | 센서별 내부온도·측압·외기·수분 그래프 |
| **데이터 업로드** | 협력사 DB에서 내려받은 CSV 업로드 (측압/수분 자동 구분) |

### 새 현장에서 쓰는 순서

1. **데이터 업로드**에 측압 CSV를 올립니다.
2. **타설 이력 › 새 타설 등록**에서 이름·타설일·센서를 고릅니다 (타설일을 주면 측압으로 시작 시각을 자동 추정).
3. **타설 시점 확인** 탭에서 추정이 맞는지 보고, 실제 시각을 알면 입력합니다.
4. **설정**에 설계기준강도(배합표)를 넣습니다.
5. 1일 공시체 결과가 나오면 **공시체 결과**에 입력합니다 → 예측이 보정됩니다.

## 3. 예측 모델

계산 방법·상수·한계의 자세한 설명(숫자 예시 포함)은 [ALGORITHMS.md](ALGORITHMS.md)에 있습니다.

| 단계 | 방법 |
|---|---|
| 적산온도 | Nurse-Saul, M = Σ max(T − 0℃, 0)·Δt (℃·일). 선택한 센서들의 내부온도 평균 |
| 강도 곡선 | 쌍곡선형 S = Su·k(M−M0)/(1+k(M−M0)), 현장양생 공시체로 학습 (예측 회차는 학습에서 제외) |
| 회차 보정 | 그 회차 현장양생 공시체가 있으면 곡선에 배율을 곱해 맞춤 |
| 미래 온도 | 기준 시각 직전 24시간 패턴이 반복된다고 가정 |
| 신뢰구간 | 학습 회차 간 교차검증 오차(로그 비율)로 90% 범위. "보수적 시각" = 하한이 기준을 넘는 시각 |

협력사 시험 타설 5회차 공시체로 회차 단위 교차검증한 결과, 3일 이내 강도 오차(RMSE)는 보정 전 1.6 MPa,
1일 공시체로 보정하면 0.7 MPa였습니다. **겨울(0℃ 부근) 데이터가 없어서 저온 예측은 검증되지 않았습니다.**

## 4. 데이터 정제 규칙

| 항목 | 규칙 |
|---|---|
| 측압 단위 | 일부 센서는 weight가 g 단위 → `.env`의 `GRAM_SENSORS`에 MAC을 적으면 kg로 환산 |
| 측압 이상치 | \|kg\| > 60 제거, 10분 중앙값 |
| 온도 | −127(센서 미연결) 제거, 채널 1~3 평균 |
| 외기 | temp = 0 이고 humi = 0 이면 미수신으로 제거 |
| 수분 | rawMo = 4095 이면 c_mo 제거 |
| 결측 | CSV의 `\0` → NULL |

원본은 `pressure`·`moisture` 테이블에 그대로 저장하고, 정제한 10분 집계는 `sensor_10min`에 저장합니다.
`pressure`·`moisture` 테이블 컬럼은 협력사 MariaDB와 같아서, 나중에 수집 서버가 이 DB로 직접 적재하도록 바꾸면
실시간 연동이 됩니다 (이때는 `app/ingest.py`의 `rebuild_10min`을 주기적으로 실행해야 합니다).

## 5. 개발 모드 (Docker 없이)

```bash
# DB만 Docker로
docker compose up -d db

# 백엔드
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements.txt
DATABASE_URL="mysql+pymysql://demold:demold@localhost:3306/demold?charset=utf8mb4" \
  .venv/bin/uvicorn app.main:app --reload

# 프론트엔드 (다른 터미널)
cd frontend && npm install && npm run dev    # http://localhost:5173
```

로그인·계정 만들기는 위 **1. 실행 › 첫 관리자 계정 만들기**를 보세요.

## 6. 알려진 한계 / 다음 단계

- 타설 시각 자동 추정은 단순 규칙이라 틀릴 수 있습니다. 실제 시각 입력을 권장합니다.
- 메일 알림, 협력사 DB 실시간 연동은 아직 없습니다.
- 권한 3단계와 각 권한의 범위는 고객 협의 전 초안입니다.
- 로그인은 쓰는 동안 자동 연장되고, 마지막 사용 후 `SESSION_HOURS`(기본 12시간)가 지나거나 로그인 후 `SESSION_MAX_DAYS`(기본 7일)가 지나면 다시 로그인해야 합니다.
- 로그인 실패가 쌓이면 잠깁니다: 같은 ID·같은 IP 10분 안에 5번, 같은 IP 20번, 같은 ID 30번 → 10분 (DB에 기록, 재시작해도 유지).
- 데이터를 바꾸는 요청과 로그인 성공·실패는 `audit_log` 테이블에 남습니다 (누가·언제·무엇을·결과, 비밀번호는 가림).
  관리자는 `GET /api/audit?user=&action=&target=` 로 조회할 수 있습니다. 화면은 아직 없습니다.
- 배합 정보가 회차마다 다르면 예측이 흔들립니다. 배합표가 들어오면 모델에 반영할 예정입니다.
