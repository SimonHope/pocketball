# Pocket Ball game server (rooms + account API). Build: docker build -t pocket-ball-server .
# ---- build: bundle the TypeScript server into one JS file ----
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:server

# ---- run: production dependencies + the bundle ----
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=2567 DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 2567
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist-server/main.js"]
