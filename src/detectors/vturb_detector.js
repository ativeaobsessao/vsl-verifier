const BaseDetector = require('./base_detector');

class VturbDetector extends BaseDetector {
  constructor() {
    super('vturb');
  }

  detectFromNetwork(networkEvents, domDiagnostics = []) {
    const candidatosMap = new Map();
    const regexVturb = /converteai\.net\/([a-f0-9-]+)\/(?:players\/)?([a-f0-9]{24})/i;

    for (const ev of networkEvents) {
      const url = ev.url || '';
      if (!url.includes('converteai.net')) continue;
      if (!url.includes('config.json') && !url.includes('main.m3u8')) continue;

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
    const regexTag = /<vturb-smartplayer[^>]*id=["'](?:vid_)?([a-f0-9]{24})["'][^>]*>/gi;
    let match;
    while ((match = regexTag.exec(html)) !== null) {
      const videoId = match[1];
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
    return candidatos;
  }
}

module.exports = new VturbDetector();
