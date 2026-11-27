# Sample Keyboard (prototype)

Load a sample and play it chromatically across two octaves. Each key is pitch-shifted
with [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/), so the
sample keeps its original length and timing instead of speeding up or slowing down.

## How it works

When a sample loads, every key (12 semitones down to 12 up from the root) is rendered
once and cached. Playback then just plays those pre-rendered buffers, so notes are
instant and polyphonic. Rendering 24 keys of a short sample takes under a second on a laptop.

The rendering lives in `stretch-render.js`. Signalsmith Stretch ships as an AudioWorklet,
but running it inside an `OfflineAudioContext` gives silent notes in iOS Safari. So the
page loads the library's own worklet processor and drives it directly in JavaScript,
128 samples at a time. The output is identical to the worklet version, and it doesn't
depend on `OfflineAudioContext` or `AudioWorklet` at all.

"Classic" mode plays the original sample at a faster or slower rate, the way old
samplers do, so you can hear the difference.

## Exporting a multi-sampled keyboard

**Export WAVs** renders every key in the chosen range (the two octaves on screen,
four octaves, or all 88 piano keys) and downloads one zip containing:

- one WAV per key, named like `MySample_060_C4.wav` (MIDI number, then note name),
  with the root note written into a `smpl` chunk so samplers can map them automatically
- an `.sfz` file that maps every WAV to its own key, for samplers that read SFZ

Files are 24-bit by default (16-bit and 32-bit float are options). For 16/24-bit,
if any key within two octaves of the root would clip, all files are turned down by
the same amount so levels stay matched. Keys further out than that can distort at
extreme shifts, so if one of those would clip it's turned down on its own instead of
dragging the whole set down. Float files are never turned down, since they can't clip.

The encoder and zip writer live in `export.js` and have no dependencies.

## Running it

The page loads `SignalsmithStretch.js` with `fetch`, so it has to be served from a web
server. Opening `index.html` straight from disk won't work.

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
