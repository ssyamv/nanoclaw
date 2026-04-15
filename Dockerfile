FROM node:20-alpine

WORKDIR /app

# Install build tools for native modules (better-sqlite3) + Docker CLI
RUN apk add --no-cache python3 make g++ bash curl jq docker-cli git

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN find src -name '*.test.ts' -delete && npm run build

# Copy container skills and groups
COPY container/ ./container/
COPY groups/ ./groups/

EXPOSE 3002

CMD ["node", "dist/index.js"]
