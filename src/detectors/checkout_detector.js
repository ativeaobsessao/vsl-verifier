const CHECKOUT_PATTERNS = [
  { plataforma: 'kiwify', regex: /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)?pay\.kiwify\.com\.br\/[a-zA-Z0-9]+/i },
  { plataforma: 'hotmart', regex: /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)?pay\.hotmart\.com\/[a-zA-Z0-9]+/i },
  { plataforma: 'eduzz', regex: /(?:https?:\/\/)?(?:sun|chk)\.eduzz\.com\/[a-zA-Z0-9]+/i },
  { plataforma: 'monetizze', regex: /(?:https?:\/\/)?app\.monetizze\.com\.br\/checkout\/[a-zA-Z0-9]+/i },
  { plataforma: 'braip', regex: /(?:https?:\/\/)?ev\.braip\.com\/checkout\/[a-zA-Z0-9]+/i },
  { plataforma: 'yampi', regex: /(?:https?:\/\/)?(?:seguro\.)?[a-zA-Z0-9-]+\.yampi\.com\.br\/[a-zA-Z0-9]+/i },
  { plataforma: 'ticto', regex: /(?:https?:\/\/)?checkout\.ticto\.com\.br\/[a-zA-Z0-9]+/i },
  { plataforma: 'perfectpay', regex: /(?:https?:\/\/)?checkout\.perfectpay\.com\.br\/[a-zA-Z0-9]+/i },
  { plataforma: 'pepper', regex: /(?:https?:\/\/)?checkout\.pepper\.com\.br\/[a-zA-Z0-9]+/i },
  { plataforma: 'kirvano', regex: /(?:https?:\/\/)?(?:checkout\.)?kirvano\.com\/[a-zA-Z0-9-]+/i },
  { plataforma: 'stripe', regex: /(?:https?:\/\/)?buy\.stripe\.com\/[a-zA-Z0-9]+/i },
  { plataforma: 'whatsapp', regex: /(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com\/send)\b[^\s"'<>]+/i }
];

function extrairParametrosUrl(urlCompleta) {
  try {
    const parsed = new URL(urlCompleta.startsWith('http') ? urlCompleta : `https://${urlCompleta}`);
    const params = {};
    for (const [k, v] of parsed.searchParams.entries()) {
      params[k] = v;
    }
    return params;
  } catch (e) {
    return {};
  }
}

class CheckoutDetector {
  identificarPlataforma(url) {
    for (const p of CHECKOUT_PATTERNS) {
      if (p.regex.test(url)) {
        return p.plataforma;
      }
    }
    return null;
  }

  detectFromHtml(html) {
    if (!html) return [];
    const checkoutsMap = new Map();

    // 1. Varrer links <a href="...">
    const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const fullTag = match[0];
      const href = match[1].trim();
      const textContent = match[2].replace(/<[^>]+>/g, '').trim();

      const plataforma = this.identificarPlataforma(href);
      if (plataforma && !checkoutsMap.has(href)) {
        const oculto = /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0/i.test(fullTag) ||
                       /class=["'][^"']*(?:delay|escond|hidden|oculto)[^"']*["']/i.test(fullTag);

        checkoutsMap.set(href, {
          plataforma,
          url: href,
          textoCta: textContent || null,
          ocultoPorDelay: oculto,
          parametros: extrairParametrosUrl(href),
          origem: 'html_link'
        });
      }
    }

    // 2. Varrer atributos data-href, onclick com window.open ou location.href
    const dataRegex = /(?:data-href|data-link)=["']([^"']+)["']/gi;
    while ((match = dataRegex.exec(html)) !== null) {
      const href = match[1].trim();
      const plataforma = this.identificarPlataforma(href);
      if (plataforma && !checkoutsMap.has(href)) {
        checkoutsMap.set(href, {
          plataforma,
          url: href,
          textoCta: null,
          ocultoPorDelay: true,
          parametros: extrairParametrosUrl(href),
          origem: 'data_attribute'
        });
      }
    }

    // 3. Varrer URLs brutas no código JavaScript
    for (const p of CHECKOUT_PATTERNS) {
      const globalRegex = new RegExp(p.regex.source, 'gi');
      let urlMatch;
      while ((urlMatch = globalRegex.exec(html)) !== null) {
        const urlFound = urlMatch[0];
        if (!checkoutsMap.has(urlFound)) {
          checkoutsMap.set(urlFound, {
            plataforma: p.plataforma,
            url: urlFound,
            textoCta: null,
            ocultoPorDelay: true,
            parametros: extrairParametrosUrl(urlFound),
            origem: 'javascript_match'
          });
        }
      }
    }

    return Array.from(checkoutsMap.values());
  }

  detectFromNetwork(networkEvents) {
    if (!networkEvents || !networkEvents.length) return [];
    const checkoutsMap = new Map();

    for (const ev of networkEvents) {
      const url = ev.url || '';
      const plataforma = this.identificarPlataforma(url);
      if (plataforma && !checkoutsMap.has(url)) {
        checkoutsMap.set(url, {
          plataforma,
          url,
          textoCta: null,
          ocultoPorDelay: false,
          parametros: extrairParametrosUrl(url),
          origem: 'network_intercept'
        });
      }
    }

    return Array.from(checkoutsMap.values());
  }
}

module.exports = new CheckoutDetector();
