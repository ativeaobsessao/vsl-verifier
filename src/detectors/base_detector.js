class BaseDetector {
  constructor(name) {
    this.name = name;
  }

  detectFromNetwork(networkEvents, domDiagnostics = []) {
    return [];
  }

  detectFromHtml(html) {
    return [];
  }
}

module.exports = BaseDetector;
