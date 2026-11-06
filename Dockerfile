FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/server/package.json apps/server/
COPY apps/bot/package.json apps/bot/
COPY apps/client/package.json apps/client/
RUN npm ci
COPY packages/domain packages/domain
COPY apps/server apps/server
COPY apps/client apps/client
RUN npx tsc -b apps/server
RUN npm run build -w @ashenfall/client
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# El servidor no usa npm en ejecución; quitarlo elimina dependencias vulnerables de la imagen base.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/packages/domain/package.json packages/domain/package.json
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/migrations apps/server/migrations
COPY --from=build /app/apps/client/dist apps/client/dist
ENV CLIENT_DIR=/app/apps/client/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health/live || exit 1
CMD ["node", "apps/server/dist/main.js"]
