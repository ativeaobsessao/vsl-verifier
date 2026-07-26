const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    service: 'viva-vsl-verifier',
    version: '0.1.0-esqueleto'
  });
});

app.listen(PORT, () => {
  console.log(`[SERVER] Verificador de VSL rodando na porta ${PORT}`);
});