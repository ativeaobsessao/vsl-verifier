class ScoringEngine {
  evaluate(candidatos) {
    if (!candidatos || candidatos.length === 0) {
      return {
        candidatosOrdenados: [],
        melhorPalpite: null,
        recomendacao: 'Nenhum vídeo foi detectado nesta sessão.'
      };
    }

    // Regra: Maior latência / pitch delay = VSL real no topo (Vídeo #01)
    // Vídeos que carregam imediatamente aos 0.0s costumam ser teasers/iscas (decoys)
    const ordenados = [...candidatos].sort((a, b) => {
      const aValido = (a.manifestUrl && a.resolvidoComSucesso !== false) ? 1 : 0;
      const bValido = (b.manifestUrl && b.resolvidoComSucesso !== false) ? 1 : 0;
      if (aValido !== bValido) return bValido - aValido;
      return (b.primeiroTempoMs || 0) - (a.primeiroTempoMs || 0);
    });

    let melhorPalpite = ordenados[0].videoId;
    let motivoPalpite = 'Apenas um vídeo foi detectado nesta página.';

    if (ordenados.length > 1) {
      const primeiro = ordenados[0];
      const segundo = ordenados[1];
      const gapMs = (primeiro.primeiroTempoMs || 0) - (segundo.primeiroTempoMs || 0);
      if (gapMs >= 2000) {
        motivoPalpite = `O vídeo ${primeiro.videoId} apareceu ${(gapMs / 1000).toFixed(1)}s após os vídeos iniciais — padrão de pitch delay da VSL real.`;
      } else {
        motivoPalpite = `O vídeo ${primeiro.videoId} foi selecionado como candidato principal por possuir o manifesto de mídia mais consistente.`;
      }
    }

    return {
      candidatosOrdenados: ordenados,
      melhorPalpite,
      recomendacao: motivoPalpite
    };
  }
}

module.exports = new ScoringEngine();
