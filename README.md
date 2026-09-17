# Low-latency audio decisions POC

Private TypeScript proof of concept: identify Spanish profanity with Jev's typed probabilistic decisions and replace the matching word intervals with a beep without changing the audio duration.

## Current file pipeline

```text
WAV/audio file
  -> ASR adapter: words + start/end milliseconds
  -> parallel Jev evaluations (Boolean profanity probability + Score severity)
  -> threshold + timestamp padding/merging
  -> ffmpeg mute/beep overlay
  -> censored WAV + JSON audit report
```

The checked-in demo uses a timestamp sidecar so the Jev and DSP path is reproducible without tying the POC to an ASR vendor. `AsrProvider` is the seam for plugging in a streaming ASR that emits partial word timestamps.

## Requirements

- Node.js 22+
- ffmpeg on `PATH`
- A TypeSafe AI API key with Jev access

## Setup and demo

```bash
npm install
export TYPESAFE_AI_API_KEY='...'
npm run check
npm run demo
```

Outputs:

- `output/prueba-censurada.wav`
- `output/prueba-censurada.wav.json`, with each word, Jev probability/score/confidence and the final beep intervals

Use another recording with a word-timestamp sidecar:

```bash
npx tsx src/cli.ts recording.wav \
  --transcript recording.words.json \
  --out output/recording-censored.wav \
  --threshold 0.72
```

Sidecar shape:

```json
{"language":"es","words":[{"word":"hola","startMs":0,"endMs":300}]}
```

## Jev contract

This uses the official `@ai-sdk/typesafe-ai` provider and `ai` evaluation API with the System One endpoint and `jev-latest` (override with `JEV_MODEL`). Every token is evaluated against its local context using two typed questions:

- `isInsult`: Boolean, which returns P(true)
- `severity`: Score with four ordered levels and TypeSafe confidence metadata

The application threshold is explicit and should be calibrated on labeled audio. The default `0.72` is a POC starting point, not a claim of production calibration.

## Small step to live streaming

The core boundaries are already streaming-shaped. A live version replaces:

1. `SidecarAsr` with an ASR adapter emitting stable partial words every 100-250 ms.
2. Whole-file Jev calls with a bounded queue and tiny local-context windows. Send only newly stable words, keep one request in flight per window, and cache normalized-word/context decisions.
3. Whole-file ffmpeg with a short PCM ring buffer (target 300-600 ms). Before releasing each frame to the output sink, apply decisions whose timestamps overlap it.

Important behavior for live use:

- Hold a bounded look-ahead buffer so a decision can arrive before the word's samples are emitted.
- Use hysteresis: a high threshold to start censorship and a slightly lower one to extend an adjacent span.
- Fail open or fail closed must be a product choice. For calls/streams, fail open with a visible health signal is usually less disruptive; regulated broadcast may choose fail closed.
- Measure end-to-end latency separately: ASR finalization, Jev RTT, queue delay, and audio buffer.
- Calibrate by language, dialect, quoted speech, reclaimed terms, and context. False positives are especially costly because they destroy audio.

## Privacy

Audio/transcript text is sent to configured providers. Do not log raw audio or API keys. Before production, set a retention policy, encrypt temporary media, delete it promptly, and verify TypeSafe's data-handling terms for the chosen account.

## Sources

- TypeSafe AI provider docs: https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai
- AI SDK evaluation docs: https://ai-sdk.dev/docs/ai-sdk-core/evaluation
- TypeSafe Jev announcement: https://typesafe.ai/blog/introducing-system-one-models-and-jev
- Vercel evaluation docs: https://vercel.com/docs/ai-gateway/modalities/evaluation
