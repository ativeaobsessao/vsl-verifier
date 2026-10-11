function log(level, event, data = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...data
  };
  console.log(JSON.stringify(payload));
}

module.exports = {
  info: (event, data) => log('INFO', event, data),
  warn: (event, data) => log('WARN', event, data),
  error: (event, data) => log('ERROR', event, data)
};
