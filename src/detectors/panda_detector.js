const BaseDetector = require('./base_detector');

class PandaDetector extends BaseDetector {
  constructor() {
    super('pandavideo');
  }

  extrairInfoPanda(reqUrl) {
    // 1. Manifesto HLS direto
    const matchHls = /(?:pandavideo\.com\.br|b-cdn\.net)\/([a-zA-Z0-9-]+)\/playlist\.m3u8/i.exec(reqUrl);
    if (matchHls) {
      return {
        videoId: matchHls[1],
        manifestUrl: reqUrl
      };
    }

    // 2. Iframe embed (player-vz-*.tv.pandavideo.com.br/embed/?v={videoId})
    const matchEmbed = /(?:tv\.pandavideo\.com\.br|pandavideo\.com\.br)\/embed\/\?v=([a-zA-Z0-9-]+)/i.exec(reqUrl);
    if (matchEmbed) {
      const videoId = matchEmbed[1];
      return {
        videoId,
        manifestUrl: `https://b-cdn.net/${videoId}/playlist.m3u8`,
        embedUrl: reqUrl
      };
    }

    return null;
  }

  detectFromNetwork(networkEvents) {
    const candidatosPandaMap = new Map();

    for (const chamada of networkEvents) {
      const url = chamada.url || '';
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
    const vistos = new Set();

    // 1. Manifestos diretos no HTML
    const regexHls = /(?:pandavideo\.com\.br|b-cdn\.net)\/([a-zA-Z0-9-]+)\/playlist\.m3u8/gi;
    let match;
    while ((match = regexHls.exec(html)) !== null) {
      const videoId = match[1];
      if (vistos.has(videoId)) continue;
      vistos.add(videoId);
      candidatos.push({
        videoId,
        plataforma: 'pandavideo',
        manifestUrl: match[0].startsWith('http') ? match[0] : `https://${match[0]}`,
        primeiroTempoMs: 0,
        primeiraDeteccao: 'fast_http',
        dimensoesNaPagina: null,
        resolvidoComSucesso: true
      });
    }

    // 2. Iframes embed Panda: embed/?v={videoId}
    const regexEmbed = /(?:tv\.pandavideo\.com\.br|pandavideo\.com\.br)\/embed\/\?v=([a-zA-Z0-9-]+)/gi;
    while ((match = regexEmbed.exec(html)) !== null) {
      const videoId = match[1];
      if (vistos.has(videoId)) continue;
      vistos.add(videoId);
      candidatos.push({
        videoId,
        plataforma: 'pandavideo',
        manifestUrl: `https://b-cdn.net/${videoId}/playlist.m3u8`,
        primeiroTempoMs: 0,
        primeiraDeteccao: 'fast_http',
        dimensoesNaPagina: null,
        resolvidoComSucesso: true
      });
    }

    // 3. Tags com id="panda-{videoId}"
    const regexTag = /id=["']panda-([a-zA-Z0-9-]+)["']/gi;
    while ((match = regexTag.exec(html)) !== null) {
      const videoId = match[1];
      if (vistos.has(videoId)) continue;
      vistos.add(videoId);
      candidatos.push({
        videoId,
        plataforma: 'pandavideo',
        manifestUrl: `https://b-cdn.net/${videoId}/playlist.m3u8`,
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
