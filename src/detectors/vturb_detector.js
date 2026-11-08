const BaseDetector = require('./base_detector');

class VturbDetector extends BaseDetector {
  constructor() {
    super('vturb');
  }

  detectFromNetwork(networkEvents, domDiagnostics = []) {
    const candidatosMap = new Map();

    // 1. Regex de manifestos de video REAIS (m3u8)
    // Ex: cdn.converteai.net/{accountUuid}/{videoId}/main.m3u8
    // Ex: cdn.converteai.net/{accountUuid}/{videoId}/video.m3u8
    const regexManifestoReal = /(?:cdn|media)?\.?converteai\.net\/([a-f0-9-]+)\/([a-f0-9]{24})\/(?:main|video|master|[0-9]+p)?\.m3u8/i;

    // 2. Regex de script do player (atenção: o hash após /players/ é o playerId de layout, NÃO o vídeo)
    // Ex: scripts.converteai.net/{accountUuid}/players/{playerId}/v4/player.js
    const regexPlayerScript = /(?:scripts\.)?converteai\.net\/([a-f0-9-]+)\/players\/([a-f0-9]{24})(?:\/v\d+)?\/player\.js/i;

    // 3. Regex de testes A/B
    const regexTestAB = /(?:scripts\.)?converteai\.net\/([a-f0-9-]+)\/(?:test|ab-test)\/([a-zA-Z0-9-_]+)\/player\.js/i;

    // Primeiro passo: identificar manifestos reais que dispararam na rede
    for (const ev of networkEvents) {
      const url = ev.url || '';
      if (!url.includes('converteai.net')) continue;

      // Se for manifesto m3u8 real
      const matchManifesto = regexManifestoReal.exec(url);
      if (matchManifesto) {
        const accountUuid = matchManifesto[1];
        const videoId = matchManifesto[2];

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
        continue;
      }

      // Se for teste A/B
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
      }
    }

    // Se nenhum manifesto m3u8 real foi disparado, mas houve carregamento de player scripts
    if (candidatosMap.size === 0) {
      for (const ev of networkEvents) {
        const url = ev.url || '';
        const matchPlayer = regexPlayerScript.exec(url);
        if (matchPlayer) {
          const accountUuid = matchPlayer[1];
          const playerId = matchPlayer[2];
          if (!candidatosMap.has(playerId)) {
            candidatosMap.set(playerId, {
              videoId: playerId,
              accountUuid,
              plataforma: 'vturb',
              tipoDeteccao: 'player_skin',
              manifestUrl: `https://cdn.converteai.net/${accountUuid}/${playerId}/main.m3u8`,
              primeiraDeteccao: ev.momento || 'antes_do_clique',
              primeiroTempoMs: ev.tempoDesdeInicioMs || 0,
              visivelNaPagina: true,
              dimensoesNaPagina: null,
              resolvidoComSucesso: false
            });
          }
        }
      }
    }

    return Array.from(candidatosMap.values());
  }

  detectFromHtml(html) {
    if (!html) return [];
    const candidatos = [];
    const vistos = new Set();

    // 1. Manifestos diretos em HTML (A FONTE MAIS CONFIÁVEL DE TODAS)
    // Ex: converteai.net/{accountUuid}/{videoId}/main.m3u8
    const regexM3u8 = /(?:cdn\.)?converteai\.net\/([a-f0-9-]+)\/([a-f0-9]{24})\/main\.m3u8/gi;
    let match;
    while ((match = regexM3u8.exec(html)) !== null) {
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

    // 2. Tag <vturb-smartplayer id="vid_{videoId}" account-uuid="...">
    const regexTag = /<vturb-smartplayer[^>]*id=["'](?:vid_)?([a-f0-9]{24})["'][^>]*>/gi;
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

    // 3. Testes A/B em script: scripts.converteai.net/{accountUuid}/(test|ab-test)/{testId}/player.js
    const regexTestScript = /(?:scripts\.)?converteai\.net\/([a-f0-9-]+)\/(?:test|ab-test)\/([a-zA-Z0-9-_]+)\/player\.js/gi;
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

    // 4. Scripts loader: APENAS SE NENHUM MANIFESTO DIRETO FOI ENCONTRADO
    // Isso evita gerar URLs falsas com o playerId caso já tenhamos os m3u8 verdadeiros
    if (candidatos.length === 0) {
      const regexScript = /(?:scripts\.)?converteai\.net\/([a-f0-9-]+)\/players\/([a-f0-9]{24})(?:\/v\d+)?\/player\.js/gi;
      while ((match = regexScript.exec(html)) !== null) {
        const accountUuid = match[1];
        const playerId = match[2];
        if (vistos.has(playerId)) continue;
        vistos.add(playerId);

        candidatos.push({
          videoId: playerId,
          accountUuid,
          plataforma: 'vturb',
          tipoDeteccao: 'player_skin',
          manifestUrl: `https://cdn.converteai.net/${accountUuid}/${playerId}/main.m3u8`,
          primeiraDeteccao: 'fast_http',
          primeiroTempoMs: 0,
          visivelNaPagina: true,
          dimensoesNaPagina: null,
          resolvidoComSucesso: false
        });
      }
    }

    return candidatos;
  }
}

module.exports = new VturbDetector();
