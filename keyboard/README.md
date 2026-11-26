# Sample Keyboard (prototype)

Load a sample and play it chromatically across two octaves. Each key is pitch-shifted
with [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/), so the
sample keeps its original length and timing instead of speeding up or slowing down.

## How it works

When a sample loads, every key (12 semitones down to 12 up from the root) is rendered
once in an `OfflineAudioContext` running the Signalsmith Stretch AudioWorklet. Playback
then just plays those pre-rendered buffers, so notes are instant and polyphonic.
Rendering 24 keys of a short sample takes about a second on a laptop.

"Classic" mode plays the original sample at a faster or slower rate, the way old
samplers do, so you can hear the difference.

## Running it

AudioWorklets need a secure context, so the page has to be served over `https://`
or `http://localhost`. Opening `index.html` straight from disk won't work.

```
cd keyboard
python3 -m http.server 8000
# then open http://localhost:8000
```

GitHub Pages also works.

## Input format

Use **WAV** (or AIFF) at 44.1 or 48 kHz, 16 or 24-bit. **FLAC** is also fine: it's
lossless and smaller. Avoid MP3/AAC for samples: pitch shifting tends to exaggerate
lossy compression artifacts, and MP3 adds a little silence at the start, which throws
off timing.

## Third-party code

`SignalsmithStretch.js` is the official Web build of Signalsmith Stretch
(npm `signalsmith-stretch@1.3.2`) by Geraint Luff, MIT licensed.
