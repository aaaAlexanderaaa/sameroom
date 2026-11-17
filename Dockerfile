FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json vite.config.ts index.html inspector.html ./
COPY admin ./admin
COPY shared ./shared
COPY server ./server
COPY scripts ./scripts
COPY src ./src
COPY public ./public
COPY examples ./examples

RUN npm run build

ENV NODE_ENV=production
ENV DASH_PORT=4100

EXPOSE 4100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.DASH_PORT||4100)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["npm", "start"]
