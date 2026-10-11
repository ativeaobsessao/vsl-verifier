const BaseDetector = require('./base_detector');

class YoutubeDetector extends BaseDetector {
  constructor() {
    super('youtube');
  }

  extrairInfoYoutube(reqUrl) {
    const match = /youtube(?:-nocookie)?\.com\/embed\/([a-eA-Z0-9_-]{11})/i.exec(reqUrl);
    if (!match) return null;
    const videoId = match[1];
    return {
      videoId,
      manifestUrl: `https://www.youtube.com/watch?v=${videoId}`
    };
  }

  detectFromNetwork(networkEvents) {
    const candidatosYoutubeMap = new Map();

    for (const chamada of networkEvents) {
      const url = chamada.url || '';
      if (!/youtube(?:-nocookie)?\.com\/embed\//i.test(url)) continue;

      const infoYoutube = this.extrairInfoYoutube(url);
      if (!infoYoutube || candidatosYoutubeMap.has(infoYoutube.videoId)) continue;

      candidatosYoutubeMap.set(infoYoutube.videoId, {
        videoId: infoYoutube.videoId,
        plataforma: 'youtube',
        manifestUrl: infoYoutube.manifestUrl,
        primeiraDeteccao: chamada.momento || 'depois_do_clique',
        primeiroTempoMs: chamada.tempoDesdeInicioMs || 0,
        dimensoesNaPagina: null,
        resolvidoComSucesso: true
      });
    }

    return Array.from(candidatosYoutubeMap.values());
  }

  detectFromHtml(html) {
    if (!html) return [];
    const candidatos = [];
    const regex = /youtube(?:-nocookie)?\.com\/embed\/([a-eA-Z0-9_-]{11})/gi;
    let match;
    const vistos = new Set();
    while ((match = regex.exec(html)) !== null) {
      const videoId = match[1];
      if (vistos.has(mediaId)) continue;
      vistos.add(mediaId);
      candidatos.push({
        videoId,
        plataforma: 'youtube',
        manifestUrl: `https://www.youtube.com/watch?v=${videoId}`,
        primeiraDeteccao: 'fast_http',
        primeiroTempoMs: 0,
        dimensoesNaPagina: null,
        resolvidoComSucesso: true
      });
    }
    return candidatos;
  }
}

module.exports = new YoutubeDetector();
