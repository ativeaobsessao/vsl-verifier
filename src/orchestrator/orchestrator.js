const { chromium, devices } = require('playwright');
const { performFastHttpCheck } = require('../acquisition/fast_http');
const { scrapeWithStealthWorker, isWorkerAvailable } = require('../acquisition/stealth_client');
const { detectors, checkout } = require('../detectors');
const scoringEngine = require('../scoring/scoring_engine');
const logger = require('../utils/logger');
const { ErroVerificacaoVsl } = require('../utils/errors');
const env = require('../config/env');
const ConcurrencySemaphore = require('./concurrency');

const semaforo = new ConcurrencySemaphore(env.SCRAPER_CONCURRENCY, env.MAX_QUEUE_SIZE);

let browserPersistente = null;

async function garantirBrowserAtivo() {
  if (browserPersistente && browserPersistente.isConnected()) {
    return browserPersistente;
  }
  browserPersistente = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote'
    ]
  });
  browserPersistente.on('disconnected', () => {
    logger.warn('BROWSER_DISCONNECTED', { msg: 'Browser persistente desconectado.' });
    browserPersistente = null;
  });
  return browserPersistente;
}

function extrairProxyUrl(useUSAProxy) {
  if (!useUSAProxy) return null;
  const server = env.PROXY_USA_SERVER || process.env.PROXY_USA_SERVER;
  if (!server) {
    throw new ErroVerificacaoVsl(
      'Proxy EUA foi solicitado, mas o servidor nao tem as variaveis PROXY_USA_SERVER configuradas.',
      'PROXY_ERROR'
    );
  }
  const username = env.PROXY_USA_USERNAME || process.env.PROXY_USA_USERNAME;
  const password = env.PROXY_USA_PASSWORD || process.env.PROXY_USA_PASSWORD;

  if (username && password) {
    const cleanServer = server.replace(/^https?:\/\//, '');
    return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${cleanServer}`;
  }
  return server.startsWith('http') ? server : `http://${server}`;
}

async function tentarCliqueNoPlayer(page, useMobileUA) {
  const seletoresPossiveis = [
    'vturb-smartplayer',
    '[id^="vid_"]',
    '[class*="vturb"]',
    '[class*="smartplayer"]',
    '[class*="player"]',
    'video',
    'iframe[src*="converteai"]',
    'iframe[src*="pandavideo"]',
    'iframe[src*="wistia"]',
    'iframe[src*="youtube"]'
  ];

  for (const seletor of seletoresPossiveis) {
    try {
      const elemento = page.locator(seletor).first();
      const existe = await elemento.count();
      if (existe > 0) {
        if (useMobileUA) {
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
  let momentoUltimaNovidade = Date.now();

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

function processarResultadosDetectores(networkEvents, html, domDiagnostics = [], wistiaAssets = new Map()) {
  let candidatos = [];

  // 1. Deteccao por rede
  if (networkEvents && networkEvents.length > 0) {
    for (const d of detectors) {
      const achados = d.detectFromNetwork(networkEvents, domDiagnostics, wistiaAssets);
      if (achados && achados.length > 0) candidatos = candidatos.concat(achados);
    }
  }

  // 2. Deteccao por HTML (caso haja tags declaradas no DOM)
  if (html) {
    for (const d of detectors) {
      const achados = d.detectFromHtml(html);
      if (achados && achados.length > 0) {
        for (const item of achados) {
          const jaExiste = candidatos.some(c => c.videoId === item.videoId && c.plataforma === item.plataforma);
          if (!jaExiste) {
            candidatos.push(item);
          }
        }
      }
    }
  }

  return candidatos;
}

function processarCheckouts(networkEvents, html) {
  const checkouts = [];
  const vistos = new Set();

  if (html) {
    const achadosHtml = checkout.detectFromHtml(html);
    for (const chk of achadosHtml) {
      if (!vistos.has(chk.url)) {
        vistos.add(chk.url);
        checkouts.push(chk);
      }
    }
  }

  if (networkEvents && networkEvents.length > 0) {
    const achadosRede = checkout.detectFromNetwork(networkEvents);
    for (const chk of achadosRede) {
      if (!vistos.has(chk.url)) {
        vistos.add(chk.url);
        checkouts.push(chk);
      }
    }
  }

  return checkouts;
}

async function executarVerificacao(url, opcoes = {}) {
  const { useMobileUA = true, useUSAProxy = false } = opcoes;
  const startTime = Date.now();

  logger.info('VERIFICATION_STARTED', { url, useMobileUA, useUSAProxy });

  const proxyUrl = extrairProxyUrl(useUSAProxy);

  // 1. TENTATIVA FAST HTTP
  let fastResult = { eligible: false, isCloudflare: false, checkouts: [] };
  try {
    fastResult = await performFastHttpCheck(url, useMobileUA);
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
        totalCheckouts: fastResult.checkouts ? fastResult.checkouts.length : 0,
        checkouts: fastResult.checkouts || [],
        meta: {
          metodoAquisicao: 'fast_http',
          duracaoMs: Date.now() - startTime
        }
      };
    }
  } catch (e) {
    logger.warn('FAST_HTTP_ERROR', { error: e.message });
  }

  // 2. TENTATIVA CAMADA 2: SCRAPLING STEALTH WORKER
  const workerReady = await isWorkerAvailable();
  const deveUsarStealth = workerReady && (fastResult.isCloudflare || useUSAProxy || true);

  if (deveUsarStealth) {
    try {
      logger.info('DISPATCHING_TO_SCRAPLING_STEALTH', {
        url,
        motivo: fastResult.isCloudflare ? 'cloudflare_detectado' : (useUSAProxy ? 'proxy_solicitado' : 'stealth_prioritario')
      });

      const stealthResult = await scrapeWithStealthWorker(url, {
        useMobileUA,
        proxyUrl,
        timeoutMs: 65000,
        solveCloudflare: true
      });

      if (stealthResult.success) {
        const candidatos = processarResultadosDetectores(
          stealthResult.networkEvents,
          stealthResult.html
        );

        const checkouts = processarCheckouts(
          stealthResult.networkEvents,
          stealthResult.html
        );

        if (candidatos.length > 0) {
          const scored = scoringEngine.evaluate(candidatos);
          logger.info('STEALTH_WORKER_CANDIDATES_FOUND', {
            url,
            totalCandidatos: scored.candidatosOrdenados.length,
            totalCheckouts: checkouts.length
          });

          return {
            status: 'ok',
            totalCandidatos: scored.candidatosOrdenados.length,
            candidatos: scored.candidatosOrdenados,
            cliqueRealizado: { sucesso: true, seletorUsado: 'scrapling-stealth' },
            melhorPalpite: scored.melhorPalpite,
            diagnosticoBruto: [],
            recomendacao: scored.recomendacao,
            totalCheckouts: checkouts.length,
            checkouts,
            meta: {
              metodoAquisicao: 'scrapling_stealth',
              duracaoMs: Date.now() - startTime,
              challengeBypassed: stealthResult.challengeBypassed,
              proxyUsed: stealthResult.proxyUsed
            }
          };
        } else if (stealthResult.challengeBypassed) {
          logger.info('STEALTH_WORKER_BYPASSED_NO_VIDEO', { url });
          return {
            status: 'nao_encontrado',
            message: 'A pagina foi acessada com sucesso pelo motor stealth, mas nenhum player suportado (Vturb/ConverteAI, PandaVideo, Wistia ou YouTube) foi detectado.',
            cliqueRealizado: { sucesso: true, seletorUsado: 'scrapling-stealth' },
            totalCheckouts: checkouts.length,
            checkouts,
            meta: {
              metodoAquisicao: 'scrapling_stealth',
              duracaoMs: Date.now() - startTime,
              challengeBypassed: true,
              proxyUsed: stealthResult.proxyUsed
            }
          };
        }
      } else {
        logger.warn('STEALTH_WORKER_UNSUCCESSFUL', {
          error: stealthResult.error,
          url
        });
      }
    } catch (err) {
      logger.error('STEALTH_WORKER_EXECUTION_ERROR', { error: err.message, url });
    }
  }

  // 3. TENTATIVA CAMADA 3: PLAYWRIGHT BROWSER (FALLBACK)
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
      const candidatosDeTag = ['vturb-smartplayer', 'div[id^="vid_"]', 'div[class*="vturb"]', '[id="player"]', 'iframe'];
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

    const pageContent = await page.content().catch(() => '');
    await context.close();

    let todosCandidatos = [];
    for (const d of detectors) {
      const achados = d.detectFromNetwork(chamadasCapturadas, infoPlayersNaTela, assetsWistiaPorMediaId);
      if (achados.length > 0) todosCandidatos = todosCandidatos.concat(achados);
    }

    // Se houve tags HTML adicionais
    if (pageContent) {
      for (const d of detectors) {
        const achados = d.detectFromHtml(pageContent);
        if (achados && achados.length > 0) {
          for (const item of achados) {
            const jaExiste = todosCandidatos.some(c => c.videoId === item.videoId && c.plataforma === item.plataforma);
            if (!jaExiste) todosCandidatos.push(item);
          }
        }
      }
    }

    const checkouts = processarCheckouts(chamadasCapturadas, pageContent);

    if (todosCandidatos.length === 0) {
      return {
        status: 'nao_encontrado',
        message: 'Nenhuma chamada de video da Vturb/ConverteAI, Wistia, PandaVideo ou YouTube foi detectada nesta pagina, mesmo apos simular o clique no player.',
        cliqueRealizado: resultadoClique,
        totalCheckouts: checkouts.length,
        checkouts,
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
      totalCheckouts: checkouts.length,
      checkouts,
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
