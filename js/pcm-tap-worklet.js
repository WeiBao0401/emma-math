// AudioWorklet for the 豆包 stream (voice-stream.js micSource, loaded with audioWorklet.addModule): mixes the microphone to mono and
// posts 2048 samples at a time to the page; on 'flush' it posts what it holds first. Same code as voice-stream.js WORKLET_SOURCE
// (tests/voice-stream.test.mjs checks), kept as a same-origin file because the page's CSP (script-src 'self') blocks the Blob URL.
// Importing it outside a worklet (the Node tests) does nothing.
const Base = globalThis.AudioWorkletProcessor || class {};
class EmmaPcmTap extends Base {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0;
    this.port.onmessage = e => { if (e.data === 'flush') { this.flush(); this.port.postMessage({ flushed: true }); } }; }
  flush() { if (this.n) { this.port.postMessage(this.buf.slice(0, this.n)); this.n = 0; } }
  process(inputs) {
    const ch = inputs[0];
    if (ch && ch.length) {
      const len = ch[0].length, k = ch.length;
      for (let i = 0; i < len; i++) {
        let s = 0; for (let c = 0; c < k; c++) s += ch[c][i];
        this.buf[this.n++] = s / k;
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('emma-pcm-tap', EmmaPcmTap);
