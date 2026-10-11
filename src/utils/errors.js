class ErroVerificacaoVsl extends Error {
  constructor(message, diagnosticCode = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'ErroVerificacaoVsl';
    this.seguroParaExibirAoUsuario = true;
    this.diagnosticCode = diagnosticCode;
  }
}

module.exports = {
  ErroVerificacaoVsl
};
