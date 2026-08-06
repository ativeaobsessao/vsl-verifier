FROM mcr.microsoft.com/playwright:v1.47.2-jammy

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 3000

# Item 10: permite que o orquestrador (Render, Railway, Cloud Run etc.) saiba se o
# container travou e precisa reiniciar. Usa o Node embutido em vez de curl/wget pra
# não depender de nada extra instalado na imagem. /api/status é leve (não abre navegador).
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/status', res => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["npm", "start"]