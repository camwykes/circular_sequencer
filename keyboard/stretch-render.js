// Offline pitch shifting with Signalsmith Stretch, run directly on the page.
//
// SignalsmithStretch.js ships as an AudioWorklet. Rendering through an
// OfflineAudioContext + AudioWorklet works in Chrome but is unreliable in
// iOS Safari (the shifted notes come out silent). So instead we load the
// library's own worklet processor class here, give it the few globals a
// worklet would have (sampleRate, currentTime), and call its process()
// method ourselves in 128-sample blocks, exactly like the browser would.
// Same DSP code, no AudioWorklet or OfflineAudioContext involved.

(function () {
  const BLOCK = 128;
  const LIB_URL = new URL('SignalsmithStretch.js', document.currentScript.src).href;

  let ProcessorClass = null;
  let setClock = null;
  let libPromise = null;

  function loadLibrary() {
    if (!libPromise) {
      libPromise = fetch(LIB_URL).then(r => {
        if (!r.ok) throw new Error('Could not load SignalsmithStretch.js');
        return r.text();
      }).then(code => {
        class FakeWorkletProcessor {
          constructor() {
            this.port = {onmessage: null, postMessage: () => {}};
          }
        }
        const register = (name, cls) => { ProcessorClass = cls; };
        // Run the library as if it were inside an AudioWorkletGlobalScope.
        const factory = new Function('AudioWorkletProcessor', 'registerProcessor', '__clock',
          'var sampleRate = 44100, currentTime = 0;\n' +
          '__clock.set = function (sr, t) { sampleRate = sr; currentTime = t; };\n' +
          code);
        const clock = {};
        factory(FakeWorkletProcessor, register, clock);
        setClock = clock.set;
        if (!ProcessorClass) throw new Error('Signalsmith processor did not register');
      });
    }
    return libPromise;
  }

  // One processor per (channel count, sample rate), reused between renders.
  const processors = new Map();

  async function getProcessor(channels, sr) {
    const key = channels + '@' + sr;
    if (processors.has(key)) return processors.get(key);
    await loadLibrary();
    setClock(sr, 0);
    const proc = new ProcessorClass({numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [channels]});
    const entry = {proc, call: null, initialTimeMap: JSON.parse(JSON.stringify(proc.timeMap))};
    await new Promise(resolve => {
      let replies = {};
      let nextId = 0;
      proc.port.postMessage = (msg) => {
        const [id, value] = msg;
        if (id === 'ready') resolve();
        else if (id !== 'time') replies[id] = value;
      };
      entry.call = (method, ...args) => {
        const id = nextId++;
        proc.port.onmessage({data: [id, method, ...args]});
        const v = replies[id];
        delete replies[id];
        return v;
      };
    });
    processors.set(key, entry);
    return entry;
  }

  // Renders are done one at a time on a shared processor.
  let queue = Promise.resolve();

  function render(channelData, sr, semitones, options = {}) {
    const job = queue.then(() => renderNow(channelData, sr, semitones, options));
    queue = job.catch(() => {});
    return job;
  }

  async function renderNow(channelData, sr, semitones, {formant = false, tailSeconds = 0.2} = {}) {
    const channels = channelData.length;
    const {proc, call, initialTimeMap} = await getProcessor(channels, sr);

    // Fresh state for this render
    setClock(sr, 0);
    proc.configure();
    proc.timeMap = JSON.parse(JSON.stringify(initialTimeMap));
    call('dropBuffers');
    call('addBuffers', channelData.map(d => d.slice()));
    call('schedule', {output: 0, active: true, input: 0, rate: 1, semitones, formantCompensation: formant});

    const length = channelData[0].length + Math.ceil(tailSeconds * sr);
    const out = [];
    for (let c = 0; c < channels; c++) out.push(new Float32Array(length));
    const blockOut = [];
    for (let c = 0; c < channels; c++) blockOut.push(new Float32Array(BLOCK));

    let lastYield = performance.now();
    for (let pos = 0; pos < length; pos += BLOCK) {
      setClock(sr, pos / sr);
      proc.process([], [blockOut], {});
      const n = Math.min(BLOCK, length - pos);
      for (let c = 0; c < channels; c++) out[c].set(n === BLOCK ? blockOut[c] : blockOut[c].subarray(0, n), pos);
      // Let the page breathe so taps and drawing stay responsive
      if (performance.now() - lastYield > 30) {
        await new Promise(r => setTimeout(r, 0));
        lastYield = performance.now();
        setClock(sr, pos / sr);
      }
    }
    return out;
  }

  window.StretchRender = {render, preload: loadLibrary};
})();
