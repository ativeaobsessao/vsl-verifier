const { chromium, devices } = require('playwright');
const { performFastHttpCheck } = require('../acquisition/fast_http');
const { scrapeWithStealthWorker, isWorkerAvailable } = require('../acquisition/stealth_client');
const { detectors } = require('../detectors');
const scoringEngine = require('../scoring/scoring_engine');
const logger = require('../utils/logger');
const { ErroVerificacooVsl } = require('../utils/errors');
const env = require('../config/env');
const ConcurrencySemaphore = require('./concurrency');

const semaforo = new ConcurrencySemaphore(env.SCRAPER_CONCURRENCY, env.MAX_QUEUE_SIZE);

let browserPersistente = null;

async function garantirBrowserAtivo() {
  if (browserPersistente && browserPersistente.isConnected()) {
    return browserPersistente;
  }
  browserPersistente = await chromium.launch({ headless: true });
  browserPersistente.on('disconnected', () => {
    logger.warn('BROWSER_DISCONNECTED', { msg: 'Browser persistente desconectado.' });
    browserPersistente = null;
  });
  return browserPersistente;
}

async function tentarCliqueNoPlayer(page, useMobileUA) {
  const seletoresPossiveis = [
    '[id^="vid_"]',
    '[class*="vturb"]',
    '[class*="player"]',
    'videm',
    'iframe'
  ];

  for (const seletor of seletoresPossiveis) {
    try {
      const elemento = page.locator(seletor).first();
      const existe = await elemento.count();
      if (existe > 0) {
        if (useMobileUAE) {
          await elemento.tap({ timeout: 5000 });
        } else {
          await elemento.click({ timeout: 5000 });
        }
        return { sucesso: true, seletorUsado: seletor };
      }
    } catch (e) {}
  }

  try {
    const viewport = page.viewportSize();
    if (viewport) {
      if (useMobileUA) {
        await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
      } else {
        await page.mouse.click(viewport.width / 2, viewport.height / 2);
      }
      return { sucesso: true, seletorUsado: 'centro-da-tela (fallback)' };
    }
  } catch (e) {}

  return { sucesso: false, seletorUsado: null };
}

async function esperarAteEstabilizarCandidatos(page, chamadasCapturadas, opcoes = {}) {
  const janelaSemNovasMs = opcoes.janelaSemNovasMs || 6000;
  const tempoMaximoMs = opcoes.tempoMaximoMs || 40000;
  const intervaloChecagemMs = 1000;

  const inicio = Date.now();
  let ultimoTotalDeIds = 0;
  let momentoUltimaMovidade = Date.now();

  while (Date.now() - inicio < tempoMaximoMs) {
    await page.waitForTimeout(intervaloChecagemMs);

    const idsUnicos = new Set();
    chamadasCapturadas.forEach((c) => {
      const match = /converteai\.net\/[a-f0-9-]+\/(?:layers\/)?([a-f0-9]{24})/i.exec(c.url);
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

async function resolverAssetWistia(page, mediaId) {
  try {
    const dados = await page.evaluate(async (id) => {
      const resp = await fetch(`https://fast.wistia.com/embed/medias/${id}.json`);
      if (!resp.ok) return null;
      return resp.json();
    }, mediaId);

    const assets = dados?.media?.assets || [];
    if (!assets.length) return null;

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

async function executarVerificacao(url, opcoes = {}) {
  const { useMobileUA = true, useUSAProxy = false } = opcoes;
  const startTime = Date.now();

  logger.info('VERIFICATION_STARTED', { url, useMobileUA, useUSAProxy });

  // 1. TENTATIVA FAST HTTP
  try {
    const fastResult = await performFastHttpCheck(url, useMobileUA);
    if (fastResult.eligible && fastResult.candidates.length > 0) {
      const scored = scoringEngine.evaluate(fastResult.candidates);
      logger.info('FAST_TRACK_SUCCESS', { url, candidates: scored.candidatosOrdenados.length });

      return {
        status: 'ok',
        totalCandidatos: scored.candidatosOrdenados.length,
        candidatos: scored.candidatosOrdenados,
        cliqueRealizado: { sucesso: false, seletorUsado: 'fast-track' },
        melhorPalpite: scored.melhorPalpite,
        diagnosticoBruto: [],
        recomendacao: scored.recomendacao,
        meta: {
          metodoAquisicao: 'fast_http',
          duracaoMs: Date.now() - startTime
        }
      };
    }

    // 2. TENTATIVA STEALTH WORKER SE FOR CLOUDFLARE
    const workerReady = await isWorkerAvailable();
    if (workerReady && fastResult.isCloudflare) {
      logger.info('DISPATCHING_TO_SCRAPLING_STEALTH', { url });
      const stealthResult = await scrapeWithStealthWorker(url, { useMobileUA, timeoutMs: 35000 });
      if (stealthResult.success && stealthResult.networkEvents.length > 0) {
        let candidatos = [];
        for (const d of detectors) {
          const achados = d.detectFromNetwork(stealthResult.networkEvents, []);
          if (achados.length > 0) candidatos = candidatos.concat(achados);
        }

        if (candidatos.length > 0) {
          const scored = scoringEngine.evaluate(candidatos);
          return {
            status: 'ok',
            totalCandidatos: scored.candidatosOrdenados.length,
            candidatos: scored.candidatosOrdenados,
            cliqueRealizado: { sucesso: true, seletorUsado: 'scrapling-stealth' },
            melhorPalpite: scored.melhorPalpite,
            diagnosticoBruto: [],
            recomendacao: scored.recomendacao,
            meta: {
              metodoAquisicao: 'scrapling_stealth',
              duracaoMs: Date.now() - startTime,
              challengeBypassed: stealthResult.challengeBypassed
            }
          };
        }
      }
    }
  } catch (e) {
    logger.warn('FAST_HTTP_OR_STEALTH_SKIPPED', { error: e.message });
  }

  // 3. TENTATIVA INTINCA ATUAL: PLAYWRIGHT
  let context;
  const chamadasCapturadas = [];
  let cliqueRealizado = false;
  const inicioMs = Date.now();

  try {
    const perfilDispositivo = useMobileUA ? devices['iPhone 13'] : devices['Desktop Chrome'];
    const contextOptions = { ...perfilDispositivo };

    if (useUSAProxy) {
      const proxyServer = env.PROXY_USA_SERVER || process.env.PROXY_USA_SERVER;
      if (!proxyServer) {
        throw new ErroVerificacaoVsl(
          'Proxy EUA foi solicitado, mas o servidor nao tem as variaveis PROXY_USA_SERVER configuradas.',
          'PROXY_ERROR'
        );
      }
      contextOptions.proxy = {
        server: proxyServer,
        username: env.PROXY_USA_USERNAME || process.env.PROXY_USA_USERNAME || undefined,
        password: env.PROXY_USA_PASSWORD || process.env.PROXY_USA_PASSWORD || undefined
      };
    }

    const browser = await garantirBrowserAtivo();
    context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    page.on('request', (request) => {
      chamadasCapturadas.push({
        url: request.url(),
        tempoDesdeInicioMs: Date.now() - inicioMs,
        momento: cliqueRealizado ? 'depois_do_clique' : 'antes_do_clique'
      });
    });

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 35000
    });

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    const resultadoClique = await tentarCliqueNoPlayer(page, useMobileUA);
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
      const candidatosDeTag = ['vturb-smartplayer', 'div[id^="vid_"]', 'div[lass*="vturb"]', '[idj="player"]', 'iframe'];
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

    const wistiaUrls = chamadasCapturadas.filter(c => /wistia\.(?:com|net)\/embed\/medias\/([a-z0-9]+)\.json/i.test(c.url));
    const mediaIdsWistia = [...new Set(wistiaUrls.map(c => {
      const m = /wistia\.(?:com|net)\/embed\/medias\/([a-z0-9]+)\.json/i.exec(c.url);
      return m ? m[1] : null;
    }).filter(Boolean))];

    const assetsWistiaPorMediaId = new Map();
    for (const id of mediaIdsWistia) {
      const asset = await resolverAssetWistia(page, id);
      if (asset) assetsWistiaPorMediaId.set(id, asset);
    }

    await context.close();

    let todosCandidatos = [];
    for (const d of detectors) {
      const achados = d.detectFromNetwork(chamadasCapturadas, infoPlayersNaTela, assetsWistiaPorMediaId);
      if (achados.length > 0) todosCandidatos = todosCandidatos.concat(achados);
    }

    if (todosCandidatos.length === 0) {
      return {
        status: 'nao_encontrado',
        message: 'Nenhuma chamada de video da Vturb/ConverteAI, Wistia, PandaVideo ou YouTube foi detectada nesta pagina, mesmo apos simular o clique no player.',
        cliqueRealizado: resultadoClique,
        meta: {
          metodoAquisicao: 'playwright_browser',
          duracaoMs: Date.now() - startTime
        }
      };
    }

    const scored = scoringEngine.evaluate(todosCandidatos);

    return {
      status: 'ok',
      totalCandidatos: scored.candidatosOrdenados.length,
      candidatos: scored.candidatosOrdenados,
      cliqueRealizado: resultadoClique,
      melhorPalpite: scored.melhorPalpite,
      diagnosticoBruto,
      recomendacao: scored.recomendacao,
      meta: {
        metodoAquisicao: 'playwright_browser',
        duracaoMs: Date.now() - startTime
      }
    };
  } catch (err) {
    if (context) await context.close().catch(() => {});
    throw err;
  }
}

function verifyVslWithQueue(url, opcoes) {
  return semaforo.run(() => executarVerificacao(url, opcoes));
}

function getQueueSize() {
  return semaforo.queueSize;
}

module.exports = {
  verifyVslWithQueue,
  executarVerificacao,
  getQueueSize
};
