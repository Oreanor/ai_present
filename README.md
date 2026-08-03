# Presenter — live captions

Slides plus live translated captions, shared straight into a Teams meeting.
No Teams Premium, no bot in the meeting, no second window for the audience.

The whole thing runs in Chrome on one machine. Full requirements are in
[`docs/TZ_presenter_live_captions.md`](docs/TZ_presenter_live_captions.md).

## The idea in one picture

| Window | Contains | Shared in Teams |
|---|---|---|
| **Presentation** | slide, annotations, caption band | **yes** |
| **Control** | log, buttons, settings | **no** |

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

Then open `out/control.html` in Chrome. No Node needed after that; hand the
`out` folder to a colleague and they just double-click.

**On a server** (Vercel and friends):

```bash
npm run dev     # http://localhost:3000/control
npm run build
```

## First run

The setup wizard asks which languages you speak, which the audience speaks,
and where captions should be shown. Everything else follows from that — the
app has no hard-coded languages.

The one choice worth understanding is **pin vs auto**:

| | Pin — you say which language | Auto — the engine decides |
|---|---|---|
| Caption delay | ~0.15 s | ~3 s |
| Live partial text | yes | no |
| Daily limits | none | shared Gemini quota |
| API key | not needed | required |
| You must remember | press `L` before switching | nothing |

**Recommended: microphone pinned, room audio auto.** You know which language
you are about to speak; you cannot know which language the next question will
come in. This also keeps the microphone — by far the chattiest channel — off
the quota entirely.

A Gemini API key is only needed if some channel is on auto. Pin both and the
app never talks to any server.

## Keys

| Key | Action |
|---|---|
| `→` `Space` `PgDn` | next slide |
| `←` `PgUp` | previous slide |
| `M` | cycle mode (presenting / Q&A / both) |
| `H` | show / hide captions — the panic key |
| `L` | microphone language |
| `G` | swap microphone to Gemini and back |
| `B` | flag last log entry |
| `E` | export transcripts |
| `Tab` | annotation shape: rectangle → ellipse → arrow |
| `Q` / `Shift+Q` | clear annotations on slide / everywhere |

Drag on the slide to draw. Left-click a shape to delete it, right-click to
undo the last one. **The PDF file is never modified** — annotations live in a
separate layer.

## Output

Two full transcripts of the whole meeting, each entirely in one language,
both sides in chronological order: `transcript-en.md`, `transcript-pt.md`
(names follow your profile). Plus a debug export with originals, and a
flagged-only list for follow-up.

## Development

```bash
npm run typecheck
node scripts/make-test-deck.mjs   # 12-page landscape test PDF
```

The **Demo** button plays a recorded script through a mock provider — no
microphone, no network, no quota. Use it to work on the log and caption UI.

`tools/probe.html` checks a machine before a real run: Translator pairs,
Web Speech, system audio capture, Gemini latency, and your speaking rate.
Open it in the target Chrome.
