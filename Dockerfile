# spec.md (Завдання 4): one image for staging and prod; GIT_SHA is baked in for /version

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY tsconfig.json ./
COPY shared shared
COPY server server
COPY --from=build /app/dist dist
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
USER node
EXPOSE 3001
CMD ["node", "--import", "tsx", "server/main.ts"]
