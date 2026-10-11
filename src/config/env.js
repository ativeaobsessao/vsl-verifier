require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  SCRAPER_CONCURRENCY: parseInt(process.env.SCRAPER_CONCURRENCY || '2', 10),
  MAX_QUEUE_SIZE: parseInt(process.env.MAX_QUEUE_SIZE || '15', 10),
  PROXY_USA_SERVER: process.env.PROXY_USA_SERVER || null,
  PROXY_USA_USERNAME: process.env.PROXY_USA_USERNAME || null,
  PROXY_USA_PASSWORD: process.env.PROXY_USA_PASSWORD || null,
  PYTHON_WORKER_URL: process.env.PYTHON_WORKER_URL || 'http://127.0.0.1:5001'
};
