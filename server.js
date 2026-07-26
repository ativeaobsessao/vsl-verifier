const express = require('express');
const cors = require('cors');
const { chromium, devices } = require('playwright');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    service: 'viva-vsl-verifier',
    version: '0.1.0-esqueleto'
  });
});

app.get('/api/teste-navegador', async (req, res) => {
  let browser;
  try {
    const perfilMobile = devices['iPhone 13'];
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ...perfilMobile });
    const page = await context.newPage();

    await page.goto('https://httpbin.org/user-agent', {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });

    const conteudo = await page.evaluate(() => document.body.innerText);

    await browser.close();

    res.json({
      status: 'ok',
      perfilUsado: 'iPhone 13',
      respostaDoSite: conteudo
    });
  } catch (err) {
    if (browser) {
      await browser.close();
    }
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/verificar-vsl', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      status: 'error',
      message: 'É necessário enviar um campo "url" válido no corpo da requisição.'
    });
  }

  let browser;
  const chamadasCapturadas = [];

  try {
    const perfilMobile = devices['iPhone 13'];
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ...perfilMobile });
    const page = await context.newPage();

    page.on('request', (request) => {
      const reqUrl = request.url();
      if (reqUrl.includes('converteai.net') && (reqUrl.includes('config.json') || reqUrl.includes('main.m3u8'))) {
        chamadasCapturadas.push(reqUrl);
      }
    });

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 25000
    });

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    await browser.close();

    const chamadaManifesto = chamadasCapturadas.find((u) => u.includes('main.m3u8'));
    const chamadaConfig = chamadasCapturadas.find((u) => u.includes('config.json'));
    const chamadaEscolhida = chamadaManifesto || chamadaConfig;

    if (!chamadaEscolhida) {
      return res.json({
        status: 'nao_encontrado',
        message: 'Nenhuma chamada de vídeo da Vturb/ConverteAI foi detectada nesta página.',
        totalChamadasRede: chamadasCapturadas.length
      });
    }

    const match = /converteai\.net\/([a-f0-9-]+)\/(?:players\/)?([a-f0-9]{24})/i.exec(chamadaEscolhida);
    const accountUuid = match ? match[1] : null;
    const videoId = match ? match[2] : null;

    res.json({
      status: 'ok',
      videoId,
      accountUuid,
      manifestUrl: (videoId && accountUuid) ? `https://cdn.converteai.net/${accountUuid}/${videoId}/main.m3u8` : null,
      capturedVia: chamadaManifesto ? 'main.m3u8 (rede real)' : 'config.json (rede real)',
      chamadaOriginal: chamadaEscolhida
    });
  } catch (err) {
    if (browser) {
      await browser.close();
    }
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[SERVER] Verificador de VSL rodando na porta ${PORT}`);
});