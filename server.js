const express = require('express');
const cors = require('cors');
const { chromium, devices } = require('playwright');

let verificacaoEmAndamento = false;
let navegadorAtivoRef = null;

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

async function tentarCliqueNoPlayer(page) {
  const seletoresPossiveis = [
    '[id^="vid_"]',
    '[class*="vturb"]',
    '[class*="player"]',
    'video',
    'iframe'
  ];

  for (const seletor of seletoresPossiveis) {
    try {
      const elemento = page.locator(seletor).first();
      const existe = await elemento.count();
      if (existe > 0) {
        await elemento.tap({ timeout: 5000 });
        return { sucesso: true, seletorUsado: seletor };
      }
    } catch (e) {
      // Se esse seletor falhar, tenta o próximo da lista
    }
  }

  try {
    const viewport = page.viewportSize();
    if (viewport) {
      await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
      return { sucesso: true, seletorUsado: 'centro-da-tela (fallback)' };
    }
  } catch (e) {}

  return { sucesso: false, seletorUsado: null };
}

// Extrai o mediaId do Wistia a partir de uma URL de rede capturada
// (ex.: fast.wistia.com/embed/medias/abcd1234ef.json)
function extrairMediaIdWistia(reqUrl) {
  const match = /wistia\.(?:com|net)\/embed\/medias\/([a-z0-9]+)\.json/i.exec(reqUrl);
  return match ? match[1] : null;
}

// Consulta a API pública de metadados do Wistia (a mesma que o player usa)
// para obter a lista de assets (arquivos mp4 reais, em várias resoluções)
// e retorna o de maior qualidade. Roda dentro da página via page.evaluate
// para herdar o referer/origin/cookies corretos da sessão do funil.
async function resolverAssetWistia(page, mediaId) {
  try {
    const dados = await page.evaluate(async (id) => {
      const resp = await fetch(`https://fast.wistia.com/embed/medias/${id}.json`);
      if (!resp.ok) return null;
      return resp.json();
    }, mediaId);

    const assets = dados?.media?.assets || [];
    if (!assets.length) return null;

    // Prioriza assets do tipo mp4 "original"/maior resolução disponível
    const mp4s = assets.filter((a) => a.type && a.type.includes('mp4') && a.url);
    if (!mp4s.length) return null;

    const melhor = mp4s.reduce((maior, atual) => {
      const larguraAtual = atual.width || 0;
      const larguraMaior = maior.width || 0;
      return larguraAtual > larguraMaior ? atual : maior;
    }, mp4s[0]);

    return {
      urlDireta: melhor.url,
      larguraPx: melhor.width || null,
      alturaPx: melhor.height || null,
      tipo: melhor.type,
      nomeVideo: dados?.media?.name || null
    };
  } catch (e) {
    return null;
  }
}

async function esperarAteEstabilizarCandidatos(page, chamadasCapturadas, opcoes = {}) {
  const janelaSemNovasMs = opcoes.janelaSemNovasMs || 6000;
  const tempoMaximoMs = opcoes.tempoMaximoMs || 40000;
  const intervaloChecagemMs = 1000;

  const inicio = Date.now();
  let ultimoTotalDeIds = 0;
  let momentoUltimaNovidade = Date.now();

  while (Date.now() - inicio < tempoMaximoMs) {
    await page.waitForTimeout(intervaloChecagemMs);

    const idsUnicos = new Set();
    chamadasCapturadas.forEach((c) => {
      const match = /converteai\.net\/[a-f0-9-]+\/(?:players\/)?([a-f0-9]{24})/i.exec(c.url);
      if (match) idsUnicos.add(match[1]);
    });

    if (idsUnicos.size > ultimoTotalDeIds) {
      ultimoTotalDeIds = idsUnicos.size;
      momentoUltimaNovidade = Date.now();
    }

    if (Date.now() - momentoUltimaNovidade >= janelaSemNovasMs) {
      break;
    }
  }
}

app.post('/api/verificar-vsl', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      status: 'error',
      message: 'É necessário enviar um campo "url" válido no corpo da requisição.'
    });
  }

  if (verificacaoEmAndamento) {
    return res.status(429).json({
      status: 'error',
      message: 'Já existe outra verificação em andamento neste momento. Aguarde cerca de 1 minuto e tente novamente.'
    });
  }

  verificacaoEmAndamento = true;

  let browser;
  const chamadasCapturadas = [];
  const chamadasWistia = [];
  let cliqueRealizado = false;
  const inicioMs = Date.now();

  try {
   const perfilMobile = devices['iPhone 13'];
    browser = await chromium.launch({ headless: true });
    navegadorAtivoRef = browser;
    const context = await browser.newContext({ ...perfilMobile });
    const page = await context.newPage();

    page.on('request', (request) => {
      const reqUrl = request.url();
      if (reqUrl.includes('converteai.net') && (reqUrl.includes('config.json') || reqUrl.includes('main.m3u8'))) {
        chamadasCapturadas.push({
          url: reqUrl,
          tempoDesdeInicioMs: Date.now() - inicioMs,
          momento: cliqueRealizado ? 'depois_do_clique' : 'antes_do_clique'
        });
      }

      // Detecção de player Wistia: o embed busca seus metadados em
      // fast.wistia.com/embed/medias/{mediaId}.json
      if (/wistia\.(?:com|net)\/embed\/medias\//i.test(reqUrl) && reqUrl.includes('.json')) {
        const mediaId = extrairMediaIdWistia(reqUrl);
        if (mediaId) {
          chamadasWistia.push({
            url: reqUrl,
            mediaId,
            tempoDesdeInicioMs: Date.now() - inicioMs,
            momento: cliqueRealizado ? 'depois_do_clique' : 'antes_do_clique'
          });
        }
      }
    });

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 35000
    });

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

   const resultadoClique = await tentarCliqueNoPlayer(page);
    cliqueRealizado = true;

    await esperarAteEstabilizarCandidatos(page, chamadasCapturadas, {
      janelaSemNovasMs: 6000,
      tempoMaximoMs: 40000
    });

    const infoPlayersNaTela = await page.evaluate(() => {
      const elementos = document.querySelectorAll('vturb-smartplayer');
      const resultado = [];
      elementos.forEach((el) => {
        const idAttr = el.id || '';
        const videoIdExtraido = idAttr.replace(/^vid-?/i, '');
        const rect = el.getBoundingClientRect();
        const estilo = window.getComputedStyle(el);
        const visivel = rect.width > 0 && rect.height > 0 &&
          estilo.display !== 'none' &&
          estilo.visibility !== 'hidden' &&
          el.offsetParent !== null;
        resultado.push({
          videoId: videoIdExtraido,
          visivel,
          larguraPx: Math.round(rect.width),
          alturaPx: Math.round(rect.height)
        });
      });
      return resultado;
    }).catch(() => []);

    const diagnosticoBruto = await page.evaluate(() => {
      const candidatosDeTag = ['vturb-smartplayer', 'div[id^="vid_"]', 'div[class*="vturb"]', '[id*="player"]', 'iframe'];
      const achados = [];
      candidatosDeTag.forEach((seletor) => {
        try {
          const els = document.querySelectorAll(seletor);
          els.forEach((el) => {
            achados.push({
              seletorQueEncontrou: seletor,
              tagName: el.tagName,
              id: el.id || null,
              className: (el.className && typeof el.className === 'string') ? el.className : null
            });
          });
        } catch (e) {}
      });
      return achados;
    }).catch((e) => [{ erro: e.message }]);

    // Resolve os assets reais do Wistia enquanto o navegador ainda está
    // aberto (a consulta usa fetch() dentro da própria página, herdando
    // sessão/referer corretos).
    const mediaIdsWistiaUnicos = [...new Set(chamadasWistia.map((c) => c.mediaId))];
    const assetsWistiaPorMediaId = new Map();
    for (const mediaId of mediaIdsWistiaUnicos) {
      const asset = await resolverAssetWistia(page, mediaId);
      if (asset) assetsWistiaPorMediaId.set(mediaId, asset);
    }

    await browser.close();
    navegadorAtivoRef = null;
    verificacaoEmAndamento = false;

    const candidatosMap = new Map();
    for (const chamada of chamadasCapturadas) {
      const match = /converteai\.net\/([a-f0-9-]+)\/(?:players\/)?([a-f0-9]{24})/i.exec(chamada.url);
      if (!match) continue;
      const accountUuid = match[1];
      const videoId = match[2];

      if (!candidatosMap.has(videoId)) {
        const infoNaTela = infoPlayersNaTela.find((p) => p.videoId === videoId);
        candidatosMap.set(videoId, {
          videoId,
          accountUuid,
          manifestUrl: `https://cdn.converteai.net/${accountUuid}/${videoId}/main.m3u8`,
          primeiraDeteccao: chamada.momento,
          primeiroTempoMs: chamada.tempoDesdeInicioMs,
          visivelNaPagina: infoNaTela ? infoNaTela.visivel : null,
          dimensoesNaPagina: infoNaTela ? `${infoNaTela.larguraPx}x${infoNaTela.alturaPx}px` : null
        });
      }
    }

    const candidatosVturb = Array.from(candidatosMap.values()).map((c) => ({
      ...c,
      plataforma: 'vturb'
    }));

    // Monta os candidatos do Wistia (um por mediaId único), já com o
    // link direto de download (mp4) resolvido via API de metadados.
    const candidatosWistiaMap = new Map();
    for (const chamada of chamadasWistia) {
      if (candidatosWistiaMap.has(chamada.mediaId)) continue;
      const asset = assetsWistiaPorMediaId.get(chamada.mediaId);
      candidatosWistiaMap.set(chamada.mediaId, {
        videoId: chamada.mediaId,
        plataforma: 'wistia',
        nomeVideo: asset ? asset.nomeVideo : null,
        linkDireto: asset ? asset.urlDireta : null,
        manifestUrl: asset ? asset.urlDireta : null, // mesmo campo que o front-end já consome
        primeiraDeteccao: chamada.momento,
        primeiroTempoMs: chamada.tempoDesdeInicioMs,
        dimensoesNaPagina: asset ? `${asset.larguraPx}x${asset.alturaPx}px` : null,
        resolvidoComSucesso: !!asset
      });
    }
    const candidatosWistia = Array.from(candidatosWistiaMap.values());

    const candidatos = [...candidatosVturb, ...candidatosWistia];

    if (candidatos.length === 0) {
      return res.json({
        status: 'nao_encontrado',
        message: 'Nenhuma chamada de vídeo da Vturb/ConverteAI ou do Wistia foi detectada nesta página, mesmo após simular o clique no player.',
        cliqueRealizado: resultadoClique
      });
    }

   const candidatosOrdenados = [...candidatos].sort((a, b) => a.primeiroTempoMs - b.primeiroTempoMs);

    let melhorPalpite = null;
    let motivoPalpite = 'Não foi possível determinar um padrão de atraso claro. Abra o manifestUrl de cada candidato e confirme visualmente qual é a VSL real antes de subir a campanha.';

    if (candidatosOrdenados.length === 1) {
      melhorPalpite = candidatosOrdenados[0].videoId;
      motivoPalpite = 'Apenas um vídeo foi detectado nesta sessão.';
    } else if (candidatosOrdenados.length > 1) {
      const ultimo = candidatosOrdenados[candidatosOrdenados.length - 1];
      const penultimo = candidatosOrdenados[candidatosOrdenados.length - 2];
      const gapMs = ultimo.primeiroTempoMs - penultimo.primeiroTempoMs;

      if (gapMs >= 3000) {
        melhorPalpite = ultimo.videoId;
        motivoPalpite = `O vídeo ${ultimo.videoId} apareceu ${(gapMs / 1000).toFixed(1)}s depois do candidato anterior — esse padrão de atraso costuma indicar a VSL real, enquanto os vídeos que aparecem juntos e imediatamente costumam ser iscas.`;
      }
    }

    res.json({
      status: 'ok',
      totalCandidatos: candidatos.length,
      candidatos: candidatosOrdenados,
      cliqueRealizado: resultadoClique,
      melhorPalpite,
      diagnosticoBruto,
      recomendacao: motivoPalpite
    });
  } catch (err) {
    if (browser) {
      await browser.close();
    }
    navegadorAtivoRef = null;
    verificacaoEmAndamento = false;
    res.status(500).json({ status: 'error', message: err.message });
  }
});

process.on('SIGTERM', async () => {
  console.log('[SERVER] SIGTERM recebido — encerrando de forma organizada...');
  if (navegadorAtivoRef) {
    try {
      await navegadorAtivoRef.close();
      console.log('[SERVER] Navegador fechado corretamente antes de encerrar.');
    } catch (e) {}
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`[SERVER] Verificador de VSL rodando na porta ${PORT}`);
});