FROM node:22-alpine

WORKDIR /app

# Install production dependencies first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --loglevel=error && npm cache clean --force

COPY . .

ENV NODE_ENV=production \
    PORT=8080

USER node
EXPOSE 8080

CMD ["node", "server.js"]
