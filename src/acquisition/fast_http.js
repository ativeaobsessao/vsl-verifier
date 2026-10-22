const { detectors, checkout } = require('../detectors');

async function performFastHttpCheck(url, useMobileUA = true) {
  const userAgent = useMobileUA
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      signal: AbortSignal.timeout(7000)
    });

    const statusCode = response.status;
    const text = await response.text();
    const serverHeader = (response.headers.get('server') || '').toLowerCase();
    const cfRay = response.headers.get('cf-ray');
    const cfMitigated = response.headers.get('cf-mitigated');

    const isCloudflare = (
      statusCode === 403 ||
      statusCode === 503 ||
      !!cfMitigated ||
      (!!cfRay && (statusCode >= 400 || text.includes('cf-'))) ||
      (serverHeader.includes('cloudflare') && (statusCode === 403 || statusCode === 503)) ||
      text.includes('challenges.cloudflare.com') ||
      text.includes('cf-turnstile') ||
      text.includes('cf-browser-verification') ||
      text.includes('<title>Just a moment...</title>') ||
      text.includes('Attention Required! | Cloudflare') ||
      text.includes('Cloudflare Ray ID')
    );

    if (isCloudflare) {
      return {
        eligible: false,
        isCloudflare: true,
        statusCode,
        candidates: [],
        checkouts: []
      };
    }

    if (statusCode !== 200) {
      return {
        eligible: false,
        isCloudflare: false,
        statusCode,
        candidates: [],
        checkouts: []
      };
    }

    // Busca de checkouts no HTML
    const checkoutsEncontrados = checkout.detectFromHtml(text);

    // Busca rápida nos detectores via HTML
    let candidatosEncontrados = [];
    for (const d of detectors) {
      const achados = d.detectFromHtml(text);
      if (achados && achados.length > 0) {
        candidatosEncontrados = candidatosEncontrados.concat(achados);
      }
    }

    // Se encontramos candidatos completos (especialmente Vturb ou Panda com manifestUrl pronto)
    const validos = candidatosEncontrados.filter(c => c.manifestUrl);
    if (validos.length > 0) {
      return {
        eligible: true,
        isCloudflare: false,
        statusCode,
        candidates: validos,
        checkouts: checkoutsEncontrados
      };
    }

    return {
      eligible: false,
      isCloudflare: false,
      statusCode,
      candidates: [],
      checkouts: checkoutsEncontrados
    };
  } catch (err) {
    return {
      eligible: false,
      isCloudflare: false,
      error: err.message,
      candidates: [],
      checkouts: []
    };
  }
}

module.exports = {
  performFastHttpCheck
};
