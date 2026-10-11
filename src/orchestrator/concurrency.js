class ConcurrencySemaphore {
  constructor(maxConcurrency = 2, maxQueueSize = 15) {
    this.maxConcurrency = maxConcurrency;
    this.maxQueueSize = maxQueueSize;
    this.activeWorkers = 0;
    this.queue = [];
  }

  get queueSize() {
    return this.queue.length;
  }

  async run(task) {
    if (this.queue.length >= this.maxQueueSize) {
      const err = new Error('A fila de processamento atingiu o limite maximo. Tente novamente em instantes.');
      err.diagnosticCode = 'QUEUE_OVERFLOW';
      err.seguroParaExibirAoUsuario = true;
      throw err;
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._processNext();
    });
  }

  _processNext() {
    if (this.activeWorkers >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    this.activeWorkers++;
    const { task, resolve, reject } = this.queue.shift();

    (async () => {
      try {
        const result = await task();
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        this.activeWorkers--;
        this._processNext();
      }
    })();
  }
}

module.exports = ConcurrencySemaphore;
