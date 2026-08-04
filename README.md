# Presenter — live captions

Slides plus live translated captions, shared straight into a Teams meeting.
No Teams Premium, no bot in the meeting, nothing for the audience to install.

Built for a room that does not share one language: written requirements are in
[`docs/TZ_presenter_live_captions.md`](docs/TZ_presenter_live_captions.md), and
a talk about how it was built is in [`docs/talk/`](docs/talk/) — English,
Portuguese and Russian.

> Em português: [README.pt.md](README.pt.md).

---

## The idea in one picture

One window, shared whole:

| Area | Contains |
|---|---|
| **Stage**, left | the slide, annotations drawn live, a full-screen button |
| **Aside**, right | start/stop, both channels, reading language, the conversation |
| **Band**, bottom | the current subtitle, large and centred |

There used to be a second, private window: the log was mine, the room saw only
the slide. Then the obvious question — *who is the log for?* It is for the
people who need to read what was just said. The private window had nothing
left to hold, so it was deleted, and everything lives in one shared picture.

Nothing on screen is secret, so share the window or the screen, whichever
Teams makes easier.

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

A setup wizard asks two things: which languages you speak, and which the
audience speaks. Everything else is derived — the subtitle language is the
room's first language, the two stored transcripts are yours and theirs. A
Portuguese colleague presenting to an English audience uses the same build
with different values.

The one choice worth understanding is **pin vs auto for the microphone**:

| | Pin — you say which language | Auto — the model decides |
|---|---|---|
| Caption delay | **~0.15 s** (measured) | ~3 s (measured) |
| Live partial text | yes, for you | no |
| Daily limits | none at all | shared Gemini quota |
| API key | not needed | required |
| You must remember | press the channel chip before switching | nothing |

**Recommended: microphone pinned.** You know which language you are about to
speak, and this keeps the chattiest channel off the quota entirely. Both
channels are cycled by their chip in the panel — `EN → PT → RU → AUTO` — and
the change applies to a running session without restarting it. `AUTO` is
offered only when a Gemini key is present, because nothing else can detect a
language.

### Why the room channel needs Gemini

The Web Speech API has no input selection at all: it listens to whatever the
system calls the default microphone, it cannot accept a `MediaStream`, and
Chrome will not run two recognisers at once. Meeting audio arrives as a
capture stream, so it can only go to a provider that accepts streams. That is
the whole reason Gemini is in the project, and why the room channel uses it
even when its language is pinned — pinning there is a hint to the model, not a
different engine.

Side effect worth knowing: because the room already goes through a model,
**automatic language detection there is free**. A question in English lands in
the log as English, not as phonetic mush.

## Money

Nothing is required to run the app: with the microphone pinned and no key you
still get captions and both transcripts, and only the room channel stays
silent.

Two protections, because "roughly thirty cents" is not something to take on
trust:

- **A hard request cap** set in settings. It stops sending. Google's budget
  alerts arrive after the fact and stop nothing.
- **A live spend counter** in the panel, computed from the actual token counts
  Gemini returns with every answer. No polling, no billing lag.

Free keys allow roughly ten requests a minute; the app respects that with a
sliding window rather than firing until it gets a 429. Tell it in settings
whether the key is free or billed — the API does not report this, and guessing
wrong means 429s on the first sentences.

## A deck in several languages

Pick several PDFs at once — the same talk typeset in different languages. The
language of each is guessed from its name (`talk-pt.pdf`) but always shown for
confirmation: opening a Portuguese file as English would put the wrong text in
front of the room, and you would find out mid-talk.

All versions must have the same number of slides; one that does not is dropped
with a message rather than silently. After that the `Read in` switch changes
the conversation, the subtitle **and the slide** together, keeping your place —
switching language does not move you in the deck.

## Keys

Deliberately few. Everything else has a button in plain sight, and a key next
to a button only asks you to remember something.

| Key | Action |
|---|---|
| `→` `Space` `PgDn` | next slide |
| `←` `PgUp` | previous slide |
| `Home` `End` | first / last slide |
| `Tab` | annotation shape: rectangle → ellipse → arrow → marker |
| `Q` / `Shift+Q` | clear annotations on this slide / everywhere |

Slides also move by voice: say **next** or **back** — in any of the three
languages — as a whole utterance on its own. Said inside a sentence it is just
a word and is ignored, and a phrase taken as a command is not written to the
log: it is control, not something said to the room.

Drag on the slide to draw; the marker draws freehand, for circling and
highlighting. Press on an existing shape to drag it somewhere else. Click a
shape to delete it, right-click to undo the last one. **The PDF is never
modified** — annotations live in a separate layer, and the file is
byte-identical afterwards.

The tool panel appears when the cursor reaches the top edge of the slide, so it
does not surface every time the mouse crosses the slide.

## Output

Two full transcripts of the whole meeting, each entirely in one language, both
sides in chronological order: `transcript-en.md`, `transcript-pt.md` (names
follow your profile). Plus a full log with originals and a flagged-only list
for follow-up. All three are in the `⋯` menu.

The conversation panel shows **one** language at a time, defaulting to the
audience's — the log is something you hand to participants, so they are the
ones who will read it. The `Read in` switch flips it; a language that is not
one of the two stored transcripts is translated in bulk on the device.

## Layout of the code

```
app/          two routes: /control (everything) and /present (a bare renderer)
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
- **`lib/geometry.ts`** holds fitting, hit-testing and the shape paths — they
  are the same calculation seen from different places.
- **`lib/ui-prefs.ts`** holds every string. Nothing is written in markup, or
  the Portuguese interface stays half English.
- **Component classes live in `app/globals.css`**, not as utility chains in
  markup: identical elements should look identical without copying a dozen
  classes, and changing how a button looks should be one edit.
- **`SpeechProvider`** is the seam. Adding an engine is a new file, not a
  change to the UI.
- **No native dialogs.** `confirm()` and `prompt()` pop up over the shared
  screen, the room reads them, and they freeze the page — recognition
  included — until someone dismisses them.

## Development

```bash
npm run typecheck
npm run build:check                # build without wrecking a running dev server
node scripts/make-test-deck.mjs    # 12-page landscape test PDF
```

`next build` and `next dev` both write to `.next` and clobber each other, which
sends a running dev server into 500s until it is restarted. `build:check`
builds into its own directory instead. `build:static` still cannot run
alongside `dev` — export mode reaches into the shared cache regardless of the
build directory.

`tools/probe.html` checks a machine before a real run: Translator pairs, Web
Speech, system audio capture, Gemini latency, and your speaking rate. Open it
in the target Chrome. It changed the architecture once already — measured
browser recognition came back twenty times faster than budgeted, which is why
the microphone stays off the cloud.

## Known limits

- Web Speech serves exactly one channel; the room needs a cloud model.
- Whether words survive its restart cycle over a long talk is **not yet
  measured**. Speak for three minutes straight and watch for gaps.
- System audio capture is a Windows story. On macOS Chrome offers tab audio
  only, so the room channel needs Teams in a Chrome tab or a virtual input
  device — and a device picker for that channel is not built yet.
- Portrait decks work but waste most of the shared frame. Landscape 16:9.
- On `file://` pdf.js runs on the main thread — Chrome refuses workers from
  file URLs. Noticeable only on the first render.
