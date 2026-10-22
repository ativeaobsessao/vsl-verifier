FROM mcr.microsoft.com/playwright:v1.47.2-jammy

WORKDIR /app

# Instalar Python e utilitarios necessarios (incluindo curl para health check interno)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
  && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json* ./
RUN npm install

COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt
RUN patchright install chromium || python3 -m patchright install chromium || true
RUN npx playwright install chromium || true

COPY . .

RUN chmod +x entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/status', res => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
