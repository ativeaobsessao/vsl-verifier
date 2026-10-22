const BaseDetector = require('./base_detector');

class VturbDetector extends BaseDetector {
  constructor() {
    super('vturb');
  }

  detectFromNetwork(networkEvents, domDiagnostics = []) {
    const candidatosMap = new Map();

    // 1. Regex de videos e manifestos padrao
    // Ex: cdn.converteai.net/{accountUuid}/{videoId}/main.m3u8
    // Ex: scripts.converteai.net/{accountUuid}/players/{videoId}/player.js
    const regexVturb = /(?:cdn|scripts)?\.?converteai\.net\/([a-f0-9-]+)\/(?:players\/|layers\/)?([a-f0-9]{24})/i;

    // 2. Regex de testes A/B
    // Ex: scripts.converteai.net/{accountUuid}/test/{testId}/player.js
    const regexTestAB = /scripts\.converteai\.net\/([a-f0-9-]+)\/test\/([a-zA-Z0-9-_]+)\/player\.js/i;

    for (const ev of networkEvents) {
      const url = ev.url || '';
      if (!url.includes('converteai.net')) continue;

      // Verificacao de Teste A/B
      const matchAB = regexTestAB.exec(url);
      if (matchAB) {
        const accountUuid = matchAB[1];
        const testId = matchAB[2];
        const key = `test_${testId}`;
        if (!candidatosMap.has(key)) {
          candidatosMap.set(key, {
            videoId: key,
            accountUuid,
            testId,
            plataforma: 'vturb',
            tipoDeteccao: 'teste_ab',
            manifestUrl: null,
            scriptUrl: url,
            primeiraDeteccao: ev.momento || 'depois_do_clique',
            primeiroTempoMs: ev.tempoDesdeInicioMs || 0,
            visivelNaPagina: true,
            dimensoesNaPagina: null,
            resolvidoComSucesso: true
          });
        }
        continue;
      }

      // Verificacao de Video Individual
      const match = regexVturb.exec(url);
      if (!match) continue;

      const accountUuid = match[1];
      const videoId = match[2];

      if (!candidatosMap.has(videoId)) {
        const infoNaTela = domDiagnostics.find((p) => p.videoId === videoId);
        candidatosMap.set(videoId, {
          videoId,
          accountUuid,
          plataforma: 'vturb',
          manifestUrl: `https://cdn.converteai.net/${accountUuid}/${videoId}/main.m3u8`,
          primeiraDeteccao: ev.momento || 'depois_do_clique',
          primeiroTempoMs: ev.tempoDesdeInicioMs || 0,
          visivelNaPagina: infoNaTela ? infoNaTela.visivel : null,
          dimensoesNaPagina: infoNaTela ? `${infoNaTela.larguraPx}x${infoNaTela.alturaPx}px` : null,
          resolvidoComSucesso: true
        });
      }
    }

    return Array.from(candidatosMap.values());
  }

  detectFromHtml(html) {
    if (!html) return [];
    const candidatos = [];
    const vistos = new Set();

    // 1. Tag <vturb-smartplayer id="vid_{videoId}" account-uuid="...">
    const regexTag = /<vturb-smartplayer[^>]*id=["'](?:vid_)?([a-f0-9]{24})["'][^>]*>/gi;
    let match;
    while ((match = regexTag.exec(html)) !== null) {
      const videoId = match[1];
      if (vistos.has(videoId)) continue;
      vistos.add(videoId);

      const accountMatch = /account-uuid=["']([a-f0-9-]+)["']/i.exec(match[0]);
      const accountUuid = accountMatch ? accountMatch[1] : null;

      candidatos.push({
        videoId,
        accountUuid,
        plataforma: 'vturb',
        manifestUrl: accountUuid ? `https://cdn.converteai.net/${accountUuid}/${videoId}/main.m3u8` : null,
        primeiraDeteccao: 'fast_http',
        primeiroTempoMs: 0,
        visivelNaPagina: true,
        dimensoesNaPagina: null,
        resolvidoComSucesso: !!accountUuid
      });
    }

    // 2. Scripts loader: scripts.converteai.net/{accountUuid}/players/{videoId}/player.js
    const regexScript = /scripts\.converteai\.net\/([a-f0-9-]+)\/players\/([a-f0-9]{24})\/player\.js/gi;
    while ((match = regexScript.exec(html)) !== null) {
      const accountUuid = match[1];
      const videoId = match[2];
      if (vistos.has(videoId)) continue;
      vistos.add(videoId);

      candidatos.push({
        videoId,
        accountUuid,
        plataforma: 'vturb',
        manifestUrl: `https://cdn.converteai.net/${accountUuid}/${videoId}/main.m3u8`,
        primeiraDeteccao: 'fast_http',
        primeiroTempoMs: 0,
        visivelNaPagina: true,
        dimensoesNaPagina: null,
        resolvidoComSucesso: true
      });
    }

    // 3. Testes A/B em script: scripts.converteai.net/{accountUuid}/test/{testId}/player.js
    const regexTestScript = /scripts\.converteai\.net\/([a-f0-9-]+)\/test\/([a-zA-Z0-9-_]+)\/player\.js/gi;
    while ((match = regexTestScript.exec(html)) !== null) {
      const accountUuid = match[1];
      const testId = match[2];
      const key = `test_${testId}`;
      if (vistos.has(key)) continue;
      vistos.add(key);

      candidatos.push({
        videoId: key,
        accountUuid,
        testId,
        plataforma: 'vturb',
        tipoDeteccao: 'teste_ab',
        manifestUrl: null,
        primeiraDeteccao: 'fast_http',
        primeiroTempoMs: 0,
        visivelNaPagina: true,
        dimensoesNaPagina: null,
        resolvidoComSucesso: true
      });
    }

    return candidatos;
  }
}

module.exports = new VturbDetector();
