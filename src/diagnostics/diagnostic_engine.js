const { CODES } = require('./codes');

class DiagnosticEngine {
  classifyError(err) {
    if (err.diagnosticCode) {
      return {
        code: err.diagnosticCode,
        message: err.message,
        isSafe: err.seguroParaExibirAoUsuario || false
      };
    }

    const msg = (err.message || '').toLowerCase();

    if (msg.includes('timeout') || msg.includes('timed out')) {
      return {
        code: CODES.TIMEOUT,
        message: 'A pagina demorou excessivamente para responder (Timeout).',
        isSafe: true
      };
    }

    if (msg.includes('cloudflare') || msg.includes('turnstile') || msg.includes('challenge')) {
      return {
        code: CODES.CLOUDFLARE_CHALLENGE,
        message: 'Acesso retido pela protecao Cloudflare.',
        isSafe: true
      };
    }

    if (msg.includes('403') || msg.includes('access denied')) {
      return {
        code: CODES.ACCESS_BLOCKED,
        message: 'Acesso bloqueado pelo servidor de origem (403 Forbidden).',
        isSafe: true
      };
    }

    return {
      code: CODES.INTERNAL_ERROR,
      message: 'Falha interna ao processar a verificacao (o erro completo foi registrado no log do servidor). Tente novamente em instantes.',
      isSafe: false
    };
  }
}

module.exports = new DiagnosticEngine();
