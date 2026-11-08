const BaseDetector = require('./base_detector');

class VturbDetector extends BaseDetector {
  constructor() {
    super('vturb');
  }

  getScriptTextFromMap(scriptsData, urlOrId) {
    if (!scriptsData || !urlOrId) return null;
    if (scriptsData.has(urlOrId)) return scriptsData.get(urlOrId);
    for (const [key, val] of scriptsData.entries()) {
      if (key.includes(urlOrId) || urlOrId.includes(key)) return val;
    }
    return null;
  }

  parseTestABScript(scriptText, defaultAccountUuid) {
    if (!scriptText || typeof scriptText !== 'string') return null;
    try {
      let realVideoId = null;
      let accountUuid = defaultAccountUuid;
      let videoName = null;
      let pitchTimeSec = null;
      const checkouts = [];

      // 1. Extrair ID real do vídeo dentro do objeto de vídeo
      const vidMatch = /video:\{[^}]*?id:["']([a-f0-9]{24})["']/i.exec(scriptText);
      if (vidMatch) {
        realVideoId = vidMatch[1];
      }

      // 2. Extrair informações dos filhos (children)
      const childMatch = /children:\[\{id:["']([a-f0-9]{24})["'].*?name:["']([^"']+)["'].*?oid:["']([a-f0-9-]+)["']/i.exec(scriptText);
      if (childMatch) {
        if (!realVideoId) realVideoId = childMatch[1];
        videoName = childMatch[2];
        if (childMatch[3]) accountUuid = childMatch[3];
      } else {
        const idAltMatch = /id:["']([a-f0-9]{24})["']/i.exec(scriptText);
        if (!realVideoId && idAltMatch) realVideoId = idAltMatch[1];
        const oidAltMatch = /oid:["']([a-f0-9-]+)["']/i.exec(scriptText);
        if (oidAltMatch) accountUuid = oidAltMatch[1];
      }

      // 3. Extrair pitchTime
      const pitchMatch = /pitchTime:(\d+)/i.exec(scriptText);
      if (pitchMatch) {
        pitchTimeSec = parseInt(pitchMatch[1], 10);
      }

      // 4. Extrair checkouts contidos nas callActions do player
      const regexCheckout = /https?:\/\/[a-zA-Z0-9-._]+(?:\/|\b)(?:pay|checkout|kiwify|hotmart|kirvano|perfectpay|cakto|monetizze|eduzz|greenn|cartpanda)[^"'\s,]*/gi;
      let chkMatch;
      const vistosChk = new Set();
      while ((chkMatch = regexCheckout.exec(scriptText)) !== null) {
        const url = chkMatch[0].replace(/\\u002F/g, '/').replace(/\\/g, '');
        if (!vistosChk.has(url)) {
          vistosChk.add(url);
          checkouts.push({
            url,
            plataforma: 'Hotmart / Checkout Oculto (Pitch Delay)',
            preco: null,
            textoBotao: 'Botão de Compra no Pitch'
          });
        }
      }

      if (realVideoId && accountUuid) {
        return {
          realVideoId,
          accountUuid,
          videoName: videoName || 'VSL Principal',
          pitchTimeSec,
          manifestUrl: `https://cdn.converteai.net/${accountUuid}/${realVideoId}/main.m3u8`,
          checkouts
        };
      }
    } catch (e) {}
    return null;
  }

  detectFromNetwork(networkEvents, domDiagnostics = [], wistiaAssets = new Map(), scriptsData = new Map()) {
    const candidatosMap = new Map();

    const regexManifestoReal = /(?:cdn|media)?\.?converteai\.net\/([a-f0-9-]+)\/([a-f0-9]{24})\/(?:main|video|master|[0-9]+p)?\.m3u8/i;
    const regexPlayerScript = /(?:scripts\.)?converteai\.net\/([a-f0-9-]+)\/players\/([a-f0-9]{24})(?:\/v\d+)?\/player\.js/i;
    const regexTestAB = /(?:scripts\.)?converteai\.net\/([a-f0-9-]+)\/(?:test|ab-test)\/([a-zA-Z0-9-_]+)\/player\.js/i;

    // 1. Manifestos reais de streaming m3u8 disparados na rede
    for (const ev of networkEvents) {
      const url = ev.url || '';
      if (!url.includes('converteai.net')) continue;

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
      }
    }

    // 2. Testes A/B capturados na rede
    for (const ev of networkEvents) {
      const url = ev.url || '';
      const matchAB = regexTestAB.exec(url);
      if (matchAB) {
        const accountUuid = matchAB[1];
        const testId = matchAB[2];
        const scriptText = this.getScriptTextFromMap(scriptsData, testId) || this.getScriptTextFromMap(scriptsData, url);
        const parsed = this.parseTestABScript(scriptText, accountUuid);

        const realId = parsed ? parsed.realVideoId : `test_${testId}`;
        const realManifest = parsed ? parsed.manifestUrl : `https://cdn.converteai.net/${accountUuid}/${realId}/main.m3u8`;

        if (!candidatosMap.has(realId)) {
          candidatosMap.set(realId, {
            videoId: realId,
            testId,
            nomeVideo: parsed ? parsed.videoName : null,
            accountUuid: parsed ? parsed.accountUuid : accountUuid,
            plataforma: 'vturb',
            tipoDeteccao: 'teste_ab',
            manifestUrl: realManifest,
            scriptUrl: url,
            pitchTimeSec: parsed ? parsed.pitchTimeSec : null,
            checkoutsExtraidos: parsed ? parsed.checkouts : [],
            primeiraDeteccao: ev.momento || 'depois_do_clique',
            primeiroTempoMs: ev.tempoDesdeInicioMs || 0,
            visivelNaPagina: true,
            dimensoesNaPagina: null,
            resolvidoComSucesso: true
          });
        }
      }
    }

    // 3. Fallback: scripts de player de layout (se nada mais foi encontrado)
    if (candidatosMap.size === 0) {
      for (const ev of networkEvents) {
        const url = ev.url || '';
        const matchPlayer = regexPlayerScript.exec(url);
        if (matchPlayer) {
          const accountUuid = matchPlayer[1];
          const playerId = matchPlayer[2];
          const scriptText = this.getScriptTextFromMap(scriptsData, playerId) || this.getScriptTextFromMap(scriptsData, url);
          const parsed = this.parseTestABScript(scriptText, accountUuid);
          const realId = parsed ? parsed.realVideoId : playerId;
          const realManifest = parsed ? parsed.manifestUrl : `https://cdn.converteai.net/${accountUuid}/${realId}/main.m3u8`;

          if (!candidatosMap.has(realId)) {
            candidatosMap.set(realId, {
              videoId: realId,
              accountUuid: parsed ? parsed.accountUuid : accountUuid,
              nomeVideo: parsed ? parsed.videoName : null,
              plataforma: 'vturb',
              tipoDeteccao: 'player_skin',
              manifestUrl: realManifest,
              pitchTimeSec: parsed ? parsed.pitchTimeSec : null,
              checkoutsExtraidos: parsed ? parsed.checkouts : [],
              primeiraDeteccao: ev.momento || 'antes_do_clique',
              primeiroTempoMs: ev.tempoDesdeInicioMs || 0,
              visivelNaPagina: true,
              dimensoesNaPagina: null,
              resolvidoComSucesso: !!parsed
            });
          }
        }
      }
    }

    return Array.from(candidatosMap.values());
  }

  detectFromHtml(html, scriptsData = new Map()) {
    if (!html) return [];
    const candidatos = [];
    const vistos = new Set();

    // 1. Manifestos diretos em HTML
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

    // 2. Testes A/B em script: scripts.converteai.net/{accountUuid}/(test|ab-test)/{testId}/player.js
    const regexTestScript = /(?:scripts\.)?converteai\.net\/([a-f0-9-]+)\/(?:test|ab-test)\/([a-zA-Z0-9-_]+)\/player\.js/gi;
    while ((match = regexTestScript.exec(html)) !== null) {
      const accountUuid = match[1];
      const testId = match[2];
      const scriptUrl = match[0];
      const scriptText = this.getScriptTextFromMap(scriptsData, testId) || this.getScriptTextFromMap(scriptsData, scriptUrl);
      const parsed = this.parseTestABScript(scriptText, accountUuid);

      const realId = parsed ? parsed.realVideoId : `test_${testId}`;
      const realManifest = parsed ? parsed.manifestUrl : `https://cdn.converteai.net/${accountUuid}/${realId}/main.m3u8`;

      if (!vistos.has(realId)) {
        vistos.add(realId);
        candidatos.push({
          videoId: realId,
          testId,
          nomeVideo: parsed ? parsed.videoName : null,
          accountUuid: parsed ? parsed.accountUuid : accountUuid,
          plataforma: 'vturb',
          tipoDeteccao: 'teste_ab',
          manifestUrl: realManifest,
          scriptUrl,
          pitchTimeSec: parsed ? parsed.pitchTimeSec : null,
          checkoutsExtraidos: parsed ? parsed.checkouts : [],
          primeiraDeteccao: 'fast_http',
          primeiroTempoMs: 0,
          visivelNaPagina: true,
          dimensoesNaPagina: null,
          resolvidoComSucesso: true
        });
      }
    }

    // 3. Tag <vturb-smartplayer id="ab-{testId}" ou id="vid_{videoId}">
    const regexTag = /<vturb-smartplayer[^>]*id=["'](?:vid_|ab-)?([a-f0-9]{24})["'][^>]*>/gi;
    while ((match = regexTag.exec(html)) !== null) {
      const rawId = match[1];
      const isAb = match[0].includes('ab-');
      const accountMatch = /account-uuid=["']([a-f0-9-]+)["']/i.exec(match[0]);
      const accountUuid = accountMatch ? accountMatch[1] : null;

      if (!vistos.has(rawId)) {
        vistos.add(rawId);
        candidatos.push({
          videoId: rawId,
          accountUuid,
          plataforma: 'vturb',
          tipoDeteccao: isAb ? 'teste_ab' : 'smartplayer_tag',
          manifestUrl: accountUuid ? `https://cdn.converteai.net/${accountUuid}/${rawId}/main.m3u8` : null,
          primeiraDeteccao: 'fast_http',
          primeiroTempoMs: 0,
          visivelNaPagina: true,
          dimensoesNaPagina: null,
          resolvidoComSucesso: !!accountUuid
        });
      }
    }

    return candidatos;
  }
}

module.exports = new VturbDetector();
