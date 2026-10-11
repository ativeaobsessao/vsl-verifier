class ScoringEngine {
  evaluate(candidatos) {
    if (!candidatos || candidatos.length === 0) {
      return {
        candidatosOrdenados: [],
        melhorPalpite: null,
        recomendacao: 'Nao foi possivel determinar um padrao de atraso claro.'
      };
    }

    // Ordena por tempo (igual ao server.js atual)
    const ordenados = [...candidatos].sort((a, b) => (a.primeiroTempoMs || 0) - (b.primeiroTempoMs || 0));

    let melhorPalpite = null;
    let motivoPalpite = 'Nao foi possivel determinar um padrao de atraso claro. Abra o manifestUrl de cada candidato e confirme visualmente qual e a VSL real antes de subir a campanha.';

    if (ordenados.length === 1) {
      melhorPalpite = ordenados[0].videoId;
      motivoPalpite = 'Apenas um video foi detectado nesta sessao.';
    } else if (ordenados.length > 1) {
      const ultimo = ordenados[ordenados.length - 1];
      const penultimo = ordenados[ordenados.length - 2];
      const gapMs = (ultimo.primeiroTempoMs || 0) - (penultimo.primeiroTempoMs || 0);

      if (gapMs >= 3000) {
        melhorPalpite = ultimo.videoId;
        motivoPalpite = `O video ${ultimo.videoId} apareceu ${(gapMs / 1000).toFixed(1)}s depois do candidato anterior - esse padrao de atraso costuma indicar a VSL real, enquanto os videos que aparecem juntos e imediatamente costumam ser iscas.`;
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
