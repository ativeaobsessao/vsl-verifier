const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');
const { ErroVerificacaoVsl } = require('../utils/errors');

function isPrivateIp(ipStr) {
  try {
    const addr = ipaddr.parse(ipStr);
    const range = addr.range();
    
    const privateRanges = [
      'loopback',
      'private',
      'linkLocal',
      'uniqueLocal',
      'carrierGradeNat'
    ];
    
    if (privateRanges.includes(range)) return true;
    if (ipStr === '0.0.0.0' || ipStr === '::') return true;
    return false;
  } catch (e) {
    return true; // Se falhou parse, bloqueia por segurança
  }
}

async function validateUrlSecurity(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    throw new ErroVerificacaoVsl('É necessário enviar um campo " url\ válido no corpo da requisição.', 'INVALID_URL');
 }

 let parsed;
 try {
 parsed = new URL(urlString);
 } catch (e) {
 throw new ErroVerificacaoVsl('Formato de URL inválido.', 'INVALID_URL');
 }

 if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
 throw new ErroVerificacaoVsl('Protocolo inválido. Apenas HTTP e HTTPS são suportados.', 'SSRF_BLOCKED');
 }

 const hostname = parsed.hostname;

 // Se já for IP literal
 if (ipaddr.isValid(hostname)) {
 if (isPrivateIp(hostname)) {
 throw new ErroVerificacaoVsl('Acesso a endereços de rede privada ou locais é proibido.', 'SSRF_BLOCKED');
 }
 return parsed.href;
 }

 // Resolve DNS para validar IP de destino
 try {
 const addresses = await dns.lookup(hostname, { all: true });
 for (const item of addresses) {
 if (isPrivateIp(item.address)) {
 throw new ErroVerificacaoVsl('O domínio resolve para endereço de rede privada ou local restrito.', 'SSRF_BLOCKED');
 }
 }
 } catch (err) {
 if (err instanceof ErroVerificacaoVsl) throw err;
 throw new ErroVerificacaoVsl('Não foi possível resolver o domínio informado (falha de DNS).', 'PAGE_LOAD_FAILED');
 }

 return parsed.href;
}

module.exports = {
 validateUrlSecurity
};
