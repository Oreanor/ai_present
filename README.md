# Presenter — live captions

Slides plus live translated captions, shared straight into a Teams meeting.
No Teams Premium, no bot in the meeting, nothing for the audience to install.

Built because half my colleagues are not comfortable in English at speaking
speed, and I speak almost no Portuguese. Written requirements are in
[`docs/TZ_presenter_live_captions.md`](docs/TZ_presenter_live_captions.md);
a talk about how it was built is in [`docs/talk/`](docs/talk/).

---

## The idea in one picture

| Window | Contains | Shared in Teams |
|---|---|---|
| **Presentation** | slide, annotations, caption band | **yes** |
| **Control** | the conversation, buttons, settings | **no** |

Captions live *inside* the shared window, so they reach the audience as part
of the picture. The log stays private.

> **Share the WINDOW, not the screen.** Sharing the whole screen puts your
> private log on the projector, and you would not notice — your own view
> looks fine.

## Two ways to run it

**Locally, no install** — the intended way for anyone who is not a developer:

```bash
npm install
npm run build:static
```

Open `out/control.html` in Chrome. Hand the `out` folder to a colleague and
they double-click it; no Node, no terminal.

**On a server** (Vercel and friends):

```bash
npm run dev      # http://localhost:3000/control
npm run build
```

Both targets come from one codebase. All the logic runs on the client; the
single API route is a thin proxy that hides a Gemini key, and it is **off by
default** — a public URL with the owner's key is an invitation to burn their
quota. Set `GEMINI_SERVER_KEY_ENABLED=1` only for a private deployment.

## First run

A setup wizard asks which languages you speak, which the audience speaks, and
where captions should be shown. Nothing else is hard-coded — a Portuguese
colleague presenting to an English audience uses the same build with different
values.

The one choice worth understanding is **pin vs auto**:

| | Pin — you say which language | Auto — the engine decides |
|---|---|---|
| Caption delay | **~0.15 s** (measured) | ~3 s (measured) |
| Live partial text | yes, for you | no |
| Daily limits | none at all | shared Gemini quota |
| API key | not needed | required |
| You must remember | press `L` before switching | nothing |

**Recommended: microphone pinned, room audio auto.** You know which language
you are about to speak; you cannot know which language the next question comes
in. This also keeps the microphone — by far the chattiest channel — off the
quota entirely.

### Why the room channel needs Gemini

The Web Speech API has no input selection at all: it listens to whatever
Windows calls the default microphone, and it cannot accept a `MediaStream`.
Meeting audio arrives as a capture stream, so it can only go to a provider
that accepts streams. That is the whole reason Gemini is in the project.

Side effect worth knowing: because the room already goes through a model,
**automatic language detection there is free**. A question in English lands in
the log as English, not as phonetic mush.

## Money

Nothing is required to run the app. Gemini is only touched by channels set to
auto, and only for the room in the recommended setup — a few cents per meeting.

Two protections, because "roughly thirty cents" is not something to take on
trust:

- **A hard request cap** set in settings. It stops sending. Google's budget
  alerts arrive after the fact and stop nothing.
- **A live spend counter** in the panel, computed from the actual token counts
  Gemini returns with every answer. No polling, no billing lag.

Free keys allow roughly ten requests a minute; the app respects that with a
sliding window rather than firing until it gets a 429.

## Keys

| Key | Action |
|---|---|
| `→` `Space` `PgDn` | next slide |
| `←` `PgUp` | previous slide |
| `M` | start / stop listening |
| `H` | show / hide captions — the panic key |
| `L` | microphone language |
| `G` | swap microphone to Gemini and back |
| `B` | flag last entry |
| `E` | export transcripts |
| `Tab` | annotation shape: rectangle → ellipse → arrow |
| `Q` / `Shift+Q` | clear annotations on slide / everywhere |

Drag on the slide to draw. Left-click a shape to delete it, right-click to
undo the last one. **The PDF is never modified** — annotations live in a
separate layer, and the file is byte-identical afterwards.

## Output

Two full transcripts of the whole meeting, each entirely in one language, both
sides in chronological order: `transcript-en.md`, `transcript-pt.md` (names
follow your profile). Plus a debug export with originals and a flagged-only
list for follow-up.

The conversation panel shows **one** language at a time, defaulting to the
audience's — the log is something you hand to participants, so they are the
ones who will read it. The `Read in` switch flips it; a language that is not
one of the two stored transcripts is translated in bulk on the device.

## Layout of the code

```
app/          two routes: /control (yours) and /present (shared)
components/   presentational pieces, no business logic
hooks/        useChannels, useDeck, useElementSize
lib/          types, store, geometry, constants, formatting
lib/speech/   SpeechProvider interface and its implementations
tools/        probe.html — checks a machine before a real run
docs/         requirements, and the talk about building this
```

Some deliberate choices:

- **`lib/constants.ts`** holds every threshold and price. Scattered magic
  numbers drift apart and start contradicting each other.
- **`lib/geometry.ts`** holds fitting, hit-testing and the arrow path — they
  are the same calculation seen from different places.
- **Component classes live in `app/globals.css`**, not as utility chains in
  markup: identical elements should look identical without copying a dozen
  classes, and changing how a button looks should be one edit.
- **`SpeechProvider`** is the seam. Adding an engine is a new file, not a
  change to the UI.

## Development

```bash
npm run typecheck
node scripts/make-test-deck.mjs    # 12-page landscape test PDF
```

`tools/probe.html` checks a machine before a real run: Translator pairs, Web
Speech, system audio capture, Gemini latency, and your speaking rate. Open it
in the target Chrome. It changed the architecture once already — measured
browser recognition came back twenty times faster than budgeted, which is why
the microphone stays off the cloud.

## Known limits

- Web Speech serves exactly one channel; the room needs a cloud model.
- Whether words survive its restart cycle over a long talk is **not yet
  measured**. Speak for three minutes straight and watch for gaps.
- Portrait decks work but waste most of the shared frame. Landscape 16:9.
- On `file://` pdf.js runs on the main thread — Chrome refuses workers from
  file URLs. Noticeable only on the first render.
