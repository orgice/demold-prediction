# 백엔드 이미지: Python 3.12 + requirements.txt 라이브러리 + app 코드
# 컨테이너가 켜지면 uvicorn이 app/main.py의 app을 8000번 포트로 실행한다
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
