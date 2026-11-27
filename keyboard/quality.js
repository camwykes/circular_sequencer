// Measures how well a sample survives pitch shifting, so the app can recommend
// a key range for it.
//
// For each shift we take an excerpt of the sample, pitch it by +s semitones,
// pitch the result back by -s, and compare it with the original excerpt.
// A perfect shifter would give back the original exactly, so the difference
// is a direct measure of the damage that size of shift does to this
// particular sound (smeared drums, phasey pads, lost highs, and so on).
//
// The comparison is on magnitude spectra (what you hear), not raw waveforms,
// so harmless phase changes don't count against a shift.

(function () {
  const FRAME = 2048;
  const HOP = 512;

  // In-place radix-2 FFT
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }

  const WINDOW = (() => {
    const w = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FRAME);
    return w;
  })();

  // Magnitude spectrogram of a mono signal: array of Float32Array(FRAME/2)
  function spectrogram(x) {
    const frames = [];
    const re = new Float32Array(FRAME), im = new Float32Array(FRAME);
    for (let start = 0; start + FRAME <= x.length; start += HOP) {
      for (let i = 0; i < FRAME; i++) { re[i] = x[start + i] * WINDOW[i]; im[i] = 0; }
      fft(re, im);
      const mag = new Float32Array(FRAME / 2);
      for (let k = 0; k < FRAME / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
      frames.push(mag);
    }
    return frames;
  }

  // Spectral signal-to-error ratio in dB: higher is better.
  // maxBin limits the comparison to frequencies below that bin.
  function spectralSNR(refSpec, testSpec, maxBin = Infinity) {
    let sig = 0, err = 0;
    const n = Math.min(refSpec.length, testSpec.length);
    for (let f = 0; f < n; f++) {
      const a = refSpec[f], b = testSpec[f];
      const kEnd = Math.min(a.length, maxBin);
      for (let k = 0; k < kEnd; k++) {
        sig += a[k] * a[k];
        const d = a[k] - b[k];
        err += d * d;
      }
    }
    if (sig === 0) return 99;
    return 10 * Math.log10(sig / Math.max(err, 1e-20));
  }

  function mono(channels) {
    if (channels.length === 1) return channels[0];
    const out = new Float32Array(channels[0].length);
    for (const c of channels) for (let i = 0; i < out.length; i++) out[i] += c[i] / channels.length;
    return out;
  }

  // Pick the loudest stretch of the sample (up to maxSeconds) to analyse,
  // so long samples stay quick and silent lead-ins don't skew the result.
  function pickExcerpt(channels, sr, maxSeconds) {
    const len = channels[0].length;
    const want = Math.min(len, Math.round(maxSeconds * sr));
    if (want === len) return channels;
    const m = mono(channels);
    const step = Math.round(sr * 0.05);
    let best = 0, bestStart = 0;
    for (let s = 0; s + want <= len; s += step) {
      let e = 0;
      for (let i = s; i < s + want; i += 16) e += m[i] * m[i];
      if (e > best) { best = e; bestStart = s; }
    }
    return channels.map(c => c.subarray(bestStart, bestStart + want));
  }

  // Round-trip score for one shift, in dB (higher is better)
  async function scoreShift(excerpt, sr, semitones, refSpec, formant) {
    const up = await StretchRender.render(excerpt, sr, semitones, {formant, tailSeconds: 0});
    const back = await StretchRender.render(up, sr, -semitones, {formant, tailSeconds: 0});
    // Shifting up pushes the very top of the spectrum past what the file can hold.
    // That loss is inaudible in the shifted note itself but shows up after shifting
    // back down, so for upward shifts only compare the part that stayed in range.
    const maxBin = semitones > 0 ? Math.floor((FRAME / 2) / Math.pow(2, semitones / 12)) : Infinity;
    return spectralSNR(refSpec, spectrogram(mono(back)), maxBin);
  }

  // Scores shifts outward from the root in both directions, up to maxShift.
  // A shift is "recommended" if it scores no more than maxDrop dB worse than a
  // one-semitone shift of the same sample. Measuring against the sample's own
  // baseline matters: a noisy or reverby recording never scores perfectly, even
  // for tiny shifts, so a fixed bar would be unfair to it.
  // Returns {scores: Map(semitones -> dB), baseline, low, high}, where low..high
  // is the recommended range in semitones relative to the root.
  async function analyse(channels, sr, {maxShift = 24, maxDrop = 3, formant = false, excerptSeconds = 1.2, onProgress, isCancelled} = {}) {
    const excerpt = pickExcerpt(channels.map(c => c.slice()), sr, excerptSeconds);
    const refSpec = spectrogram(mono(excerpt));
    const scores = new Map();
    let done = 0;
    const score = async s => {
      if (isCancelled && isCancelled()) throw new Error('cancelled');
      const v = await scoreShift(excerpt, sr, s, refSpec, formant);
      scores.set(s, v);
      if (onProgress) onProgress(++done);
      return v;
    };
    const baseline = ((await score(1)) + (await score(-1))) / 2;
    const ok = v => baseline - v <= maxDrop;
    const limits = {};
    for (const dir of [1, -1]) {
      limits[dir] = ok(scores.get(dir)) ? 1 : 0;
      if (!limits[dir]) continue;
      let failures = 0;
      for (let s = 2; s <= maxShift; s++) {
        if (ok(await score(dir * s))) {
          if (failures === 0) limits[dir] = s;
        } else if (++failures >= 2) {
          break; // two in a row below the bar: stop looking further out
        }
      }
    }
    return {scores, baseline, low: -limits[-1], high: limits[1]};
  }

  window.SampleQuality = {analyse, scoreShift, spectrogram, spectralSNR, pickExcerpt, mono};
})();
