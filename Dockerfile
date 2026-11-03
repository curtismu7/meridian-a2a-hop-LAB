# Meridian A2A hop LAB in Docker (OrbStack). Build the web app, then run the API server, which also serves web/dist.
# The default image runs in mock mode: the stub issuer and every tool backend are in the process, and nothing leaves the container.
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --no-audit --no-fund
COPY web web
RUN npm run build -w web

FROM node:26-alpine
WORKDIR /app
# HOST=0.0.0.0 is inside the container only; docker-compose.yml publishes the port on 127.0.0.1 and sets LAB_PUBLISH=loopback.
ENV NODE_ENV=production PORT=6600 HOST=0.0.0.0
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev -w server --no-audit --no-fund && npm cache clean --force
COPY server/src server/src
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 6600
CMD ["node", "server/src/index.js"]
