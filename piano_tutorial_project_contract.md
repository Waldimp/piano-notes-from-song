# Piano Tutorial Project — Technical Contract & Working Specification

## 1. Purpose

Build a **private, personal-use piano tutorial application** that converts piano audio into an interactive **falling-notes tutorial** similar in spirit to Falling Note / Synthesia-style visualization.

The first goal is not to reproduce every feature of an existing commercial product. The project should instead prioritize:

- reliable piano transcription,
- a useful falling-notes tutorial,
- simple local execution,
- an architecture that can evolve later,
- low or zero infrastructure cost during the prototype stage.

This project is intended for personal/private use and will initially be tested locally.

---

## 2. Core Product Idea

The user provides a piano audio file.

The system processes the audio using an **Automatic Music Transcription (AMT)** model and produces structured musical events.

Those events are then rendered in a browser as a synchronized piano tutorial with notes falling toward an 88-key virtual keyboard.

Initial flow:

```text
Piano audio
    ↓
Audio preprocessing
    ↓
Automatic Music Transcription
    ↓
Normalized note-event representation
    ↓
Falling-notes renderer
    ↓
Interactive piano tutorial
```

---

## 3. Current Technical Direction

### Primary AMT engine

The first model to evaluate and integrate is:

**High-Resolution Piano Transcription**

Reasons:

- specifically designed for piano,
- produces pitch/onset/offset/velocity information,
- includes pedal-related output,
- better aligned with the project than a general-purpose multi-instrument transcription model.

### Secondary / fallback AMT engine

**Spotify Basic Pitch**

Basic Pitch is not the initial engine, but the architecture should avoid coupling the application tightly to a single transcription implementation.

The backend should expose a normalized transcription result so another engine can be substituted later.

Conceptual abstraction:

```python
class TranscriptionEngine:
    def transcribe(self, audio_path):
        ...
```

Possible implementations:

```text
HighResolutionPianoEngine
BasicPitchEngine
FutureEngine
```

The frontend must not depend directly on a specific AMT engine.

---

## 4. Important Design Principle

### Nothing is permanently fixed at this stage

This document describes the **current preferred direction**, not an immutable final architecture.

During implementation, decisions may change due to:

- model quality,
- CPU/RAM usage,
- library compatibility,
- browser performance,
- deployment limitations,
- user experience,
- better technical discoveries.

When a decision changes, prefer documenting:

1. what changed,
2. why it changed,
3. what tradeoff was accepted.

Avoid redesigning major components without a concrete reason.

---

# 5. Development Strategy

Development will initially focus only on **Phase 1 and Phase 2**.

The objective is to prove the complete core experience locally before spending time on authentication, databases, cloud deployment, queues, infrastructure, or production hardening.

---

# 6. Phase 1 — Audio → Transcription

## Goal

Prove that a piano audio file can be transformed into sufficiently accurate musical note events.

### Input

Initially support at least:

```text
.wav
.mp3
```

Other formats such as:

```text
.m4a
.flac
.ogg
```

may be added if preprocessing through FFmpeg makes them trivial.

### Processing pipeline

```text
Audio file
   ↓
Validation
   ↓
FFmpeg / normalization if required
   ↓
High-Resolution Piano Transcription
   ↓
Raw model events
   ↓
Normalization layer
   ↓
notes.json
   ↓
optional MIDI export
```

### Required output

The main application contract should be a JSON structure rather than MIDI.

Example:

```json
{
  "version": 1,
  "duration": 183.42,
  "source": {
    "filename": "song.mp3"
  },
  "transcription": {
    "engine": "high-resolution-piano-transcription"
  },
  "notes": [
    {
      "pitch": 60,
      "start": 1.234,
      "end": 1.756,
      "velocity": 86,
      "hand": null
    }
  ],
  "pedals": []
}
```

### Required note fields

At minimum:

```text
pitch
start
end
velocity
```

Optional / future fields:

```text
hand
confidence
channel
pedal state
measure
beat
```

### MIDI

MIDI may also be generated for:

- debugging,
- listening tests,
- comparison,
- external software compatibility.

However, MIDI is **not required to be the frontend's primary data contract**.

### Phase 1 completion criteria

Phase 1 is considered successful when:

- a local audio file can be processed,
- the model runs reliably on the development machine,
- the result can be exported to `notes.json`,
- timestamps appear correctly aligned with the audio,
- the generated MIDI is usable for sanity checking,
- at least several representative piano songs have been tested.

---

# 7. Phase 1 Benchmarking

Before optimizing the application, test the transcription engine using different piano recordings.

Recommended test set:

```text
simple slow piece
piece with dense chords
fast passage
sustained pedal
digital piano recording
acoustic piano recording
clean studio audio
phone-recorded piano audio
```

Track observations such as:

| Test | Notes | False Notes | Timing | Chords | Pedal | Overall |
|---|---|---|---|---|---|---|
| Piece 1 | | | | | | |
| Piece 2 | | | | | | |

If High-Resolution Piano Transcription produces unacceptable results, evaluate Basic Pitch using the same files.

Do not change engines based on assumptions; compare actual output.

---

# 8. Phase 2 — Interactive Falling-Notes Tutorial

## Goal

Build a browser-based tutorial from the normalized note-event JSON.

### Core UI

The first tutorial should include:

- piano keyboard,
- falling note bars,
- audio playback,
- play/pause,
- seek,
- current time,
- duration,
- synchronized animation.

### Strongly desired controls

```text
0.50x
0.75x
1.00x
```

Potential later speeds:

```text
0.25x
1.25x
1.50x
```

### Looping

Support an A/B practice loop:

```text
A ├──────────────┤ B
```

The user should be able to repeat a difficult passage continuously.

### Keyboard

Render an **88-key piano keyboard**.

Each note event is mapped from MIDI pitch to a visual key.

### Falling-note calculation

Conceptually:

```text
distance = note.start - currentTime
y = keyboardY - distance * pixelsPerSecond
```

Note-bar height:

```text
height = (note.end - note.start) * pixelsPerSecond
```

When:

```text
currentTime == note.start
```

the note should reach the keyboard.

### Renderer implementation

Preferred initial approach:

**HTML Canvas**

Reasons:

- enough performance for the prototype,
- simpler than introducing WebGL prematurely,
- easy control over animation,
- suitable for hundreds/thousands of rectangles.

If profiling later shows Canvas is insufficient, WebGL may replace it without changing the note-event contract.

### Synchronization

The audio element should be the authoritative timing source.

Avoid maintaining an independent timer that slowly drifts away from audio playback.

Typical model:

```text
audio.currentTime
       ↓
renderer
       ↓
visible note positions
```

Use `requestAnimationFrame` for rendering.

---

# 9. Hand Separation

Hand classification is **not required for the first functioning tutorial**.

Initial note representation may use:

```json
"hand": null
```

A later post-processing module may infer:

```text
left
right
```

Possible future methods include:

- fixed pitch split,
- dynamic split point,
- continuity between nearby notes,
- cluster analysis,
- range penalties,
- crossing penalties,
- optimization over note sequences.

This feature should not block Phase 1 or Phase 2.

---

# 10. Monorepo Requirement

The project should use **one monorepo**.

The purpose is to allow one coding agent to understand and orchestrate:

- frontend,
- backend,
- shared contracts,
- scripts,
- migrations,
- future infrastructure.

Recommended structure:

```text
piano-tutorial/
│
├── apps/
│   ├── web/
│   │   └── frontend
│   │
│   └── api/
│       └── Python backend
│
├── packages/
│   ├── contracts/
│   ├── shared/
│   └── ui/              # optional
│
├── ml/
│   ├── engines/
│   ├── preprocessing/
│   └── scripts/
│
├── data/
│   ├── input/
│   ├── output/
│   └── samples/
│
├── migrations/
│   └── future database migrations
│
├── docs/
│   ├── decisions/
│   └── architecture/
│
├── scripts/
│
├── .env.example
├── README.md
└── docker-compose.yml   # optional / later
```

This structure is a guideline.

Claude may improve it if there is a clear technical reason, but the project must remain a monorepo.

---

# 11. Preferred Initial Stack

## Frontend

Preferred:

```text
Next.js
React
TypeScript
```

Alternative frontend structures are acceptable if they provide a clear advantage.

### Rendering

Start with:

```text
Canvas 2D
```

Do not introduce heavy visualization dependencies until needed.

---

## Backend

Preferred:

```text
Python
FastAPI
```

Primary responsibilities:

- audio upload or local file handling,
- preprocessing,
- AMT execution,
- normalized JSON creation,
- optional MIDI export,
- local development API.

---

## Audio processing

Preferred:

```text
FFmpeg
```

Use it when necessary for:

- format conversion,
- resampling,
- channel conversion,
- normalization.

Do not transform audio unnecessarily if the AMT model accepts the source correctly.

---

## AMT / ML

Primary:

```text
High-Resolution Piano Transcription
```

Fallback:

```text
Spotify Basic Pitch
```

---

## Database

No database is required for Phase 1 or Phase 2.

However, the repository should leave a clear place for future migrations.

Likely future candidate:

```text
Supabase / PostgreSQL
```

Do not add Supabase solely for the first prototype unless the implementation genuinely needs persistent application state.

---

# 12. Local-First Development

The application should initially work completely on the developer machine.

Expected development topology:

```text
Browser
   ↓
Next.js frontend
   ↓
FastAPI local backend
   ↓
Python AMT model
   ↓
local filesystem
```

No cloud dependency should be required to validate Phase 1 and Phase 2.

---

# 13. Future Deployment Direction

Deployment is intentionally postponed until after the tutorial works.

Likely future architecture:

```text
Vercel
  └── Next.js frontend

Supabase
  ├── Auth
  ├── PostgreSQL
  └── Storage

ML Worker
  └── Python / PyTorch
```

Possible worker locations may include:

- local machine,
- cloud container,
- scheduled/on-demand compute,
- another suitable provider.

Do not prematurely bind the project to Render, Railway, Hugging Face, or another provider.

First measure:

```text
RAM usage
CPU usage
transcription time
model startup time
```

Then select deployment infrastructure.

---

# 14. Browser-Only Alternative

A browser-only implementation is still considered a valid future option.

Example:

```text
Browser
   ↓
Basic Pitch TypeScript / browser inference
   ↓
notes
   ↓
Falling Notes
```

This could eliminate the ML backend entirely.

However, it is not the first implementation because the current priority is to evaluate the specialized piano model.

The architecture should avoid preventing a later browser-only engine.

---

# 15. API Contract

During local development, an initial API may look like:

```text
POST /api/transcriptions
GET  /api/transcriptions/{id}
GET  /api/transcriptions/{id}/notes
GET  /api/transcriptions/{id}/midi
```

For a very early proof of concept, a synchronous endpoint is acceptable.

Example:

```text
POST /api/transcribe
```

returning:

```json
{
  "notes": [],
  "pedals": [],
  "duration": 0
}
```

If transcription is too slow for a normal request lifecycle, refactor into an asynchronous job model later.

Do not build queues before measurements prove they are needed.

---

# 16. Shared Contract

The note schema should be explicitly versioned.

Example TypeScript representation:

```ts
export type Hand = "left" | "right" | null;

export interface PianoNote {
  pitch: number;
  start: number;
  end: number;
  velocity: number;
  hand: Hand;
}

export interface PedalEvent {
  start: number;
  end: number;
}

export interface PianoTranscription {
  version: 1;
  duration: number;
  source: {
    filename: string;
  };
  transcription: {
    engine: string;
  };
  notes: PianoNote[];
  pedals: PedalEvent[];
}
```

The equivalent Python model should validate the same logical contract.

A schema change should be deliberate and versioned.

---

# 17. Error Handling

The prototype should still handle obvious failures cleanly.

Examples:

```text
unsupported file
corrupt audio
FFmpeg unavailable
model checkpoint unavailable
model inference failure
empty transcription
invalid notes JSON
```

Avoid raw stack traces in the frontend.

Logs should preserve enough detail for debugging.

---

# 18. Performance Guidelines

Do not optimize blindly.

Measure first.

Important metrics:

```text
audio duration
transcription runtime
peak RAM usage
model load time
number of detected notes
frontend FPS
```

For the renderer, avoid iterating over every note in a long song every animation frame if it becomes expensive.

Potential later optimization:

```text
binary search / time-window indexing
```

Only render notes near the current playback window.

---

# 19. Development Priorities

Priority order:

```text
1. Correct transcription
2. Correct synchronization
3. Functional tutorial
4. Good practice controls
5. Simple UX
6. Performance optimization
7. Persistence
8. Cloud deployment
9. Additional features
```

Do not prioritize visual polish over transcription or synchronization.

---

# 20. Explicit Non-Goals for Initial Prototype

Do not implement these in the first two phases unless they become trivial:

```text
YouTube import
TikTok import
Instagram import
payments
subscriptions
multi-user administration
social features
native mobile applications
sheet music generation
automatic chord labels
complex hand detection
MIDI keyboard input
real-time microphone transcription
production-scale queues
analytics
```

These are possible future features, not initial requirements.

---

# 21. Possible Future Features

After Phase 1 and Phase 2 are validated, potential extensions include:

### Phase 3 — Library / Persistence

```text
Supabase Auth
PostgreSQL
Storage
song library
saved transcriptions
```

### Phase 4 — Automated Processing

```text
upload
→ transcription job
→ status
→ completed tutorial
```

### Phase 5 — Deployment

```text
Vercel frontend
+
remote ML worker
+
Supabase
```

### Phase 6 — Practice Enhancements

Possible features:

```text
left hand only
right hand only
hand inference
MIDI keyboard input
wait-for-correct-note mode
tempo/beat estimation
metronome
sections/bookmarks
practice history
```

These phase numbers may change.

---

# 22. Coding Expectations

The codebase should favor:

- clear boundaries,
- small modules,
- typed contracts,
- simple implementations,
- maintainability,
- testable pure logic,
- minimal unnecessary abstraction.

Avoid:

- speculative microservices,
- premature queues,
- excessive design patterns,
- hidden magic,
- huge files,
- hard-coded filesystem assumptions,
- tightly coupling UI to the ML library.

---

# 23. Testing Expectations

At minimum, add automated tests for logic that can be tested cheaply.

Examples:

```text
pitch → keyboard mapping
note visibility calculations
falling-note position calculations
note schema validation
audio metadata parsing
engine normalization logic
```

AMT model inference itself does not need to run in every normal unit test.

Use fixtures or sample normalized transcription files for frontend tests.

---

# 24. Documentation Expectations

Maintain:

```text
README.md
docs/
```

README should explain:

- prerequisites,
- project structure,
- frontend startup,
- backend startup,
- model setup,
- FFmpeg setup,
- how to process a sample,
- how to open the tutorial.

Significant technical decisions may be documented under:

```text
docs/decisions/
```

Example:

```text
0001-use-high-resolution-piano-transcription.md
```

---

# 25. Definition of the First Successful Prototype

The project reaches its first meaningful milestone when this sequence works locally:

```text
1. Start backend.
2. Start frontend.
3. Select a piano audio file.
4. Transcribe it using the High-Resolution Piano model.
5. Generate normalized notes.
6. Load the resulting tutorial.
7. Press Play.
8. Hear the original audio.
9. See notes move in synchronization.
10. See notes reach the correct virtual piano keys.
11. Slow playback down.
12. Loop a selected passage.
```

At that point, stop and evaluate the product before adding infrastructure.

---

# 26. Decision Gate After Phase 2

After the tutorial works, evaluate:

### AMT

```text
Is transcription quality good enough?
```

If no:

```text
compare Basic Pitch
adjust preprocessing
evaluate another model
```

### Compute

```text
How much RAM does transcription use?
How long does a 3–5 minute song take?
```

### Deployment

Choose between:

```text
local worker
remote Python worker
browser-only Basic Pitch
hybrid architecture
```

### Persistence

Decide whether Supabase is actually needed.

Only then define the next production architecture.

---

# 27. Guiding Rule for the Coding Agent

When uncertain between a complex and simple implementation, prefer the simplest implementation that:

1. preserves the architecture boundaries,
2. produces a working prototype,
3. does not block a known future requirement.

The objective is to **validate the product**, not to simulate a production SaaS platform before one is needed.
