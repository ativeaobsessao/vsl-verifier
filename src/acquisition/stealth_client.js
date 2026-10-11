const { PYTHON_WORKER_URL } = require('../config/env');

async function scrapeWithStealthWorker(url, options = {}) {
  const { useMobileUA = true, proxyUrl = null, timeoutMs = 35000 } = options;

  try {
    const response = await fetch(`${PYTHON_WORKER_URL}/v1/stealth-scrape`, {
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
      signal: AbortSignal.timeout(timeoutMs + 5000)
    });

    if (!response.ok) {
      return {
        success: false,
        networkEvents: [],
        html: '',
        challengeBypassed: false
      };
    }

    const data = await response.json();
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
    const response = await fetch(`${PYTHON_WORKER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000)
    });
    return response.ok;
  } catch (e) {
    return false;
  }
}

module.exports = {
  scrapeWithStealthWorker,
  isWorkerAvailable
};
