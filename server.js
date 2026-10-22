const express = require('express');
const cors = require('cors');
const env = require('./src/config/env');
const logger = require('./src/utils/logger');
const { validateUrlSecurity } = require('./src/security/ssrf_filter');
const { verifyVslWithQueue, getQueueSize } = require('./src/orchestrator/orchestrator');
const diagnosticEngine = require('./src/diagnostics/diagnostic_engine');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = env.PORT || 3000;

app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    service: 'viva-vsl-verifier',
    version: '2.0.0',
    tamanhoFilaAtual: getQueueSize()
  });
});

app.all('/api/proxy-html', async (req, res) => {
  const targetUrl = req.method === 'POST' ? req.body?.url : req.query?.url;
  const useMobile = req.method === 'POST' ? req.body?.useMobileUA !== false : req.query?.useMobile !== 'false';

  if (!targetUrl) {
    return res.status(400).json({ error: 'URL obrigatoria' });
  }

  try {
    const safeUrl = await validateUrlSecurity(targetUrl);
    const userAgent = useMobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

    const resp = await fetch(safeUrl, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      signal: AbortSignal.timeout(15000)
    });

    const html = await resp.text();
    const headersObj = {};
    if (resp.headers && typeof resp.headers.forEach === 'function') {
      resp.headers.forEach((val, key) => { headersObj[key.toLowerCase()] = val; });
    }

    res.json({
      success: resp.ok,
      status: resp.status,
      html,
      headers: headersObj,
      url: safeUrl
    });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err.message,
      url: targetUrl
    });
  }
});

app.post('/api/verificar-vsl', async (req, res) => {
  const { url, useMobileUA = true, useUSAProxy = false } = req.body;

  try {
    // 1. Validacao de Seguranca & SSRF
    const safeUrl = await validateUrlSecurity(url);

    // 2. Execucao via Orquestrador e Fila
    const resultado = await verifyVslWithQueue(safeUrl, {
      useMobileUA: !!useMobileUA,
      useUSAProxy: !!useUSAProxy
    });

    res.json(resultado);
  } catch (err) {
    logger.error('VERIFICATION_FAILED', { url, error: err.message, stack: err.stack });

    const diagnosed = diagnosticEngine.classifyError(err);
    const statusCode = diagnosed.code === 'QUEUE_OVERFLOW' ? 429 : (diagnosed.code === 'SSRF_BLOCKED' || diagnosed.code === 'INVALID_URL' ? 400 : 500);

    const mensagemParaUsuario = diagnosed.isSafe
      ? diagnosed.message
      : 'Falha interna ao processar a verificação (o erro completo foi registrado no log do servidor). Tente novamente em instantes — se persistir, me chame com o horário aproximado pra eu conferir o log.';

    res.status(statusCode).json({
      status: 'error',
      message: mensagemParaUsuario,
      codigoDiagnostico: diagnosed.code
    });
  }
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM_RECEIVED', { msg: 'Encerrando aplicacao de forma organizada...' });
  process.exit(0);
});

app.listen(PORT, () => {
  logger.info('SERVER_STARTED', { port: PORT, version: '2.0.0' });
  console.log(`[SERVER] Verificador de VSL v2.0 rodando na porta ${PORT}`);
});
