const { request } = require('undici');
const { PYTHON_WORKER_URL } = require('../config/env');

async function scrapeWithStealthWorker(url, options = {}) {
  const { useMobileUA = true, proxyUrl = null, timeoutMs = 35000 } = options;

  try {
    const { statusCode, body } = await request(`${PYTHON_WORKER_URL}/v1/stealth-scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        useMobileUA,
        proxyUrl,
        timeoutMs
      }),
      headersTimeout: timeoutMs + 5000,
      bodyTimeout: timeoutMs + 5000
    });

    if (statusCode !== 200) {
      return {
        success: false,
        networkEvents: [],
        html: '',
        challengeBypassed: false
      };
    }

    const data = await body.json();
    return {
      success: data.status === 'ok',
      networkEvents: data.networkEvents || [],
      html: data.html || '',
      challengeBypassed: !!data.challengeBypassed
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      networkEvents: [],
      html: '',
      challengeBypassed: false
    };
  }
}

async function isWorkerAvailable() {
  try {
    const { statusCode } = await request(`${PYTHON_WORKER_URL}/health`, {
      method: 'GET',
      headersTimeout: 2000,
      bodyTimeout: 2000
    });
    return statusCode === 200;
  } catch (e) {
    return false;
  }
}

module.exports = {
  scrapeWithStealthWorker,
  isWorkerAvailable
};
