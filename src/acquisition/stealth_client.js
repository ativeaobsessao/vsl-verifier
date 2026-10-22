const { PYTHON_WORKER_URL } = require('../config/env');
const logger = require('../utils/logger');

async function scrapeWithStealthWorker(url, options = {}) {
  const {
    useMobileUA = true,
    proxyUrl = null,
    timeoutMs = 65000,
    solveCloudflare = true
  } = options;

  logger.info('STEALTH_WORKER_REQUEST', {
    url,
    useMobileUA,
    hasProxy: !!proxyUrl,
    timeoutMs,
    solveCloudflare
  });

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
        timeoutMs,
        solveCloudflare
      }),
      signal: AbortSignal.timeout(timeoutMs + 10000)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      logger.warn('STEALTH_WORKER_HTTP_ERROR', {
        status: response.status,
        error: errorText
      });
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
        networkEvents: [],
        html: '',
        challengeBypassed: false,
        proxyUsed: false
      };
    }

    const data = await response.json();
    logger.info('STEALTH_WORKER_RESPONSE', {
      status: data.status,
      networkEventsCount: data.networkEvents?.length || 0,
      challengeBypassed: data.challengeBypassed,
      proxyUsed: data.proxyUsed
    });

    return {
      success: data.status === 'ok',
      networkEvents: data.networkEvents || [],
      html: data.html || '',
      challengeBypassed: !!data.challengeBypassed,
      proxyUsed: !!data.proxyUsed,
      message: data.message || null
    };
  } catch (err) {
    logger.error('STEALTH_WORKER_FAILED', { error: err.message, url });
    return {
      success: false,
      error: err.message,
      networkEvents: [],
      html: '',
      challengeBypassed: false,
      proxyUsed: false
    };
  }
}

async function isWorkerAvailable() {
  try {
    const response = await fetch(`${PYTHON_WORKER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2500)
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
