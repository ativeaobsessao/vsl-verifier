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
