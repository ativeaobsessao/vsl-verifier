const BaseDetector = require('./base_detector');

class PandaDetector extends BaseDetector {
  constructor() {
    super('pandavideo');
  }

  extrairInfoPanda(reqUrl) {
    const match = /(?:pandavideo\.com\.br|b-cdn\.net)\/([a-zA-Z0-9-]+)\/playlist\.m3u8/i.exec(reqUrl);
    if (!match) return null;
    return {
      videoId: match[1],
      manifestUrl: reqUrl
    };
  }

  detectFromNetwork(networkEvents) {
    const candidatosPandaMap = new Map();

    for (const chamada of networkEvents) {
      const url = chamada.url || '';
      if (!url.includes('playlist.m3u8')) continue;
      if (!url.includes('pandavideo.com.br') && !url.includes('b-cdn.net')) continue;

      const infoPanda = this.extrairInfoPanda(url);
      if (!infoPanda || candidatosPandaMap.has(infoPanda.videoId)) continue;

      candidatosPandaMap.set(infoPanda.videoId, {
        videoId: infoPanda.videoId,
        plataforma: 'pandavideo',
        manifestUrl: infoPanda.manifestUrl,
        primeiraDeteccao: chamada.momento || 'depois_do_clique',
        primeiroTempoMs: chamada.tempoDesdeInicioMs || 0,
        dimensoesNaPagina: null,
        resolvidoComSucesso: true
      });
    }

    return Array.from(candidatosPandaMap.values());
  }

  detectFromHtml(html) {
    if (!html) return [];
    const candidatos = [];
    const regex = /(?:pandavideo\.com\.br|b-cdn\.net)\/([a-zA-Z0-9-]+)\/playlist\.m3u8/gi;
    let match;
    const vistos = new Set();
    while ((match = regex.exec(html)) !== null) {
      const videoId = match[1];
      if (vistos.has(videoId)) continue;
      vistos.add(videoId);
      candidatos.push({
        videoId,
        plataforma: 'pandavideo',
        manifestUrl: match[0],
        primeiroTempoMs: 0,
        primeiraDeteccao: 'fast_http',
        dimensoesNaPagina: null,
        resolvidoComSucesso: true
      });
    }
    return candidatos;
  }
}

module.exports = new PandaDetector();
