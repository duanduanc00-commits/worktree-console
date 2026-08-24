FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    git-lfs \
    lsof \
    openssh-client \
    procps \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV WORKTREE_CONSOLE_DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/bin ./bin
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/README.md ./README.md
COPY --from=build /app/LICENSE ./LICENSE

RUN mkdir -p /data

EXPOSE 5273

CMD ["npm", "start", "--", "--host", "0.0.0.0", "--port", "5273", "--data-dir", "/data", "--no-open"]
