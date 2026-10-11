const BaseDetector = require('./base_detector');

class WistiaDetector extends BaseDetector {
  constructor() {
    super('wistia');
  }

  extrairMediaId(reqUrl) {
    const match = /wistia\.(?:com|net)\/embed\/medias\/([a-z0-9]+)\.json/i.exec(reqUrl);
    return match ? match[1] : null;
  }

  detectFromNetwork(networkEvents, domDiagnostics = [], resolvedAssets = new Map()) {
    const candidatosWistiaMap = new Map();

    for (const chamada of networkEvents) {
      const url = chamada.url || '';
      if (!/wistia\.(?:com|net)\/embed\/medias\//i.test(url) || !url.includes('.json')) {
        continue;
      }
      const mediaId = this.extrairMediaId(url);
      if (!mediaId || candidatosWistiaMap.has(mediaId)) continue;

      const asset = resolvedAssets.get(mediaId);
      candidatosWistiaMap.set(mediaId, {
        videoId: mediaId,
        plataforma: 'wistia',
        nomeVideo: asset ? asset.nomeVideo : null,
        linkDireto: asset ? asset.urlDireta : null,
        manifestUrl: asset ? asset.urlDireta : null,
        primeiraDeteccao: chamada.momento || 'depois_do_clique',
        primeiroTempoMs: chamada.tempoDesdeInicioMs || 0,
        dimensoesNaPagina: asset ? `${asset.larguraPx}x${asset.alturaPx}px` : null,
        resolvidoComSucesso: !!asset
      });
    }

    return Array.from(candidatosWistiaMap.values());
  }

  detectFromHtml(html) {
    if (!html) return [];
    const candidatos = [];
    const regex = /wistia\.(?:com|net)\/embed\/medias\/([a-z0-9]+)\.json/gi;
    let match;
    const vistos = new Set();
    while ((match = regex.exec(html)) !== null) {
      const mediaId = match[1];
      if (vistos.has(mediaId)) continue;
      vistos.add(mediaId);
      candidatos.push({
        videoId: mediaId,
        plataforma: 'wistia',
        nomeVideo: null,
        linkDireto: null,
        manifestUrl: null,
        primeiraDeteccao: 'fast_http',
        primeiroTempoMs: 0,
        dimensoesNaPagina: null,
        resolvidoComSucesso: false
      });
    }
    return candidatos;
  }
}

module.exports = new WistiaDetector();
