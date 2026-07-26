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

app.listen(PORT, () => {
  console.log(`[SERVER] Verificador de VSL rodando na porta ${PORT}`);
});