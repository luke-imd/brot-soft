# Ein Container: baut das React-Frontend und liefert es zusammen mit der API aus.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
RUN apk add --no-cache tzdata
ENV NODE_ENV=production TZ=Europe/Vienna PORT=3000 DB_FILE=/data/garage.db \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
# Läuft als root: Synology-Bind-Mounts gehören dem DSM-User, ein Nicht-root-User könnte sonst nicht schreiben.
RUN rm -f server/*.test.js && mkdir -p /data
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server/index.js"]
