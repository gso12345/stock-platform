# 실행 방법

## 1. 백엔드 (FastAPI)

### 사전 준비
- Python 3.11 (`backend/runtime.txt`)
- DB 는 따로 안 깔아도 된다 — `DATABASE_URL` 을 안 주면 `backend/stockplatform.db`(SQLite)를 쓴다.
  배포 서버는 Supabase PostgreSQL 을 쓴다(Render 환경변수 `DATABASE_URL`).

### 환경 설정
```bash
cd backend
cp .env.example .env
# API 키는 없어도 서버는 뜬다 — 키가 없는 원천에서 받는 것만 빠진다(아래 'API 키')
```

### 의존성 설치 및 실행
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

백엔드 실행 후 http://localhost:8000/docs 에서 API 문서 확인

---

## 2. 프론트엔드 (React + Vite)

### 사전 준비
- Node.js 20+

### 의존성 설치 및 실행
```bash
cd frontend
npm install
npm run dev
```

프론트엔드: http://localhost:5173 (`/api` 요청은 8000 번 백엔드로 넘어간다 — `vite.config.ts`)

윈도우에서는 `start-dev.bat` 이 둘을 한꺼번에 띄운다(경로는 자기 컴퓨터에 맞게).

---

## 3. 시험

```bash
cd backend  && python -m pytest -q
cd frontend && npm run typecheck && npm test
```

---

## 4. 배포

`main` 에 올리면 자동으로 나간다.
- 백엔드: Render (`render.yaml`)
- 화면: Vercel (`vercel.json`)

Render 무료 서버는 15분 동안 아무도 안 오면 잠든다 — `.github/workflows/keep-alive.yml` 이 깨워 둔다.

---

## 5. 폴더

```
backend/app
  main.py          앱 시작·라우터 등록
  api/routes/      주소별 라우트 (종목 상세는 stocks/ 아래 탭별 파일로 나뉘어 있다)
  api/websocket/   실시간 시세
  core/            바탕 — 캐시·설정·인증·스레드·메모리·받기 규칙
  db/  models/     DB 연결과 표
  services/        하는 일 — 분야별 폴더 (지도는 services/__init__.py)
    market/          시세·지수·환율·장 시간·순위
    listings/        상장 종목 목록
    fundamentals/    펀더멘털·재무제표
    quant/           퀀트 점수
    portfolio/       내 자산 — 평가액 기록·보유 뉴스·배당
    backtest/        백테스트
    scheduler.py     뒤에서 도는 갱신 / news_service · ipo_service …
backend/tests      백엔드 시험

frontend/src
  main.tsx         화면 주소 등록
  pages/           화면 하나에 파일 하나
  components/      화면 조각 — 분야별 폴더
    layout/          틀·검색·로고·시작 화면
    account/         로그인 단추·설정창·회원 탈퇴
    ui/  common/     어디서나 쓰는 것
    stock/ portfolio/ watchlist/ screening/ backtest/ community/ ipo/ admin/ chart/ quant/
  api/             서버 부르기 — 분야별 파일. 화면은 모두 api/stocks.ts 에서 가져간다
  hooks/ utils/ store/ types/ constants/
```

---

## API 키 (backend/.env)

| 키 | 쓰는 곳 | 없으면 |
|---|---|---|
| `KIS_APP_KEY` · `KIS_APP_SECRET` · `KIS_ACCOUNT_NO` · `KIS_IS_REAL` | 한국투자증권 — 국내 실시간 시세 | 네이버·야후로 받는다 |
| `FINNHUB_API_KEY` | 미국 실시간 시세 | 야후로 받는다 |
| `DART_API_KEY` | 국내 공시·재무제표 | 야후 재무제표로 받는다 |
| `FMP_API_KEY` | 해외 재무제표 | 야후 재무제표로 받는다 |
| `ANTHROPIC_API_KEY` | 뉴스 AI 요약 | 요약만 빠진다 |

KIS 키 발급: 한국투자증권 계좌 개설 → https://apiportal.koreainvestment.com → 앱 등록 → APP KEY / SECRET.
`KIS_IS_REAL=false` 는 모의투자, `true` 는 실거래.
