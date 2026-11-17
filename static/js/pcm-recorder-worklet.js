class MagnusPcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samplesPerChunk = sampleRate * 10;
    this.samples = new Int16Array(this.samplesPerChunk);
    this.offset = 0;
    this.port.onmessage = (event) => {
      if (event.data === 'flush') {
        this.emitChunk();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }

  emitChunk() {
    if (!this.offset) return;
    const audio = this.samples.slice(0, this.offset).buffer;
    this.port.postMessage({ type: 'chunk', audio }, [audio]);
    this.samples = new Int16Array(this.samplesPerChunk);
    this.offset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    if (input) {
      for (let index = 0; index < input.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, input[index]));
        this.samples[this.offset] = sample < 0 ? sample * 32768 : sample * 32767;
        this.offset += 1;
        if (this.offset === this.samplesPerChunk) this.emitChunk();
      }
    }
    for (const channel of outputs[0] || []) channel.fill(0);
    return true;
  }
}

registerProcessor('magnus-pcm-recorder', MagnusPcmRecorder);
