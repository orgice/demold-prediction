# 프론트엔드 이미지 (2단계)
# 1단계: Node.js로 React 코드를 빌드해 정적 파일(HTML·JS·CSS)을 만든다 (tsc 타입 검사 포함)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# 2단계: 빌드 결과만 nginx 웹 서버에 넣는다 (Node.js는 최종 이미지에 들어가지 않음)
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
