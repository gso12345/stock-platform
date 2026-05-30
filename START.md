# 실행 방법

## 1. 백엔드

### 사전 준비
- Python 3.12+
- PostgreSQL 16
- Redis 7

### 환경 설정
```bash
cd backend
cp .env.example .env
# .env 파일에 KIS API 키 입력
```

### 의존성 설치 및 실행
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

백엔드 실행 후 http://localhost:8000/docs 에서 API 문서 확인

---

## 2. 프론트엔드

### 사전 준비
- Node.js 20+

### 의존성 설치 및 실행
```bash
cd frontend
npm install
npm run dev
```

프론트엔드: http://localhost:5173

---

## Docker로 한번에 실행 (PostgreSQL + Redis + 백엔드)

```bash
# .env 파일 먼저 설정
cp backend/.env.example backend/.env

docker-compose up -d
```

---

## KIS API 키 발급

1. 한국투자증권 계좌 개설
2. https://apiportal.koreainvestment.com 접속
3. 앱 등록 → APP KEY / SECRET 발급
4. backend/.env 에 입력:
   - KIS_APP_KEY=발급받은키
   - KIS_APP_SECRET=발급받은시크릿
   - KIS_ACCOUNT_NO=계좌번호
   - KIS_IS_REAL=false (모의투자) / true (실거래)
