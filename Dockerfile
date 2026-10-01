FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    libdbus-1-3 libglib2.0-0 libx11-6 libxcb1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

RUN npx playwright install chromium

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]