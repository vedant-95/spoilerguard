# SpoilerGuard for YouTube

Covers spoilery or unwanted YouTube thumbnails and titles behind a "privacy cover" until you
choose to reveal them. Searching for one walkthrough, or for a match you have not watched yet,
should not hand you the ending in your recommendations.

Landing page: `docs/index.html` (serve `docs/` with GitHub Pages).

## Install (no Chrome Web Store needed)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. The settings page opens. Add a list from **Community made lists** (or write your own words),
   then open YouTube.

## How it decides what to hide

For every video tile on the page, SpoilerGuard reads the title, channel name and handle *before*
you look at it, and compares them against your active **block packs**. A pack is a plain list of:

| Field | Meaning |
| --- | --- |
| `terms` | words / phrases to hide, matched on whole words so `gow` never matches `Glasgow` |
| `channels` | channel names or `@handles` to hide entirely |
| `regex` | optional advanced patterns |
| `except` | words that cancel a match (e.g. hide `ragnarok` but not `thor ragnarok`) |
| `expiresAt` | pack switches itself off on this date, i.e. "block until I finish the game" |
| `onlyAfter` | only hide videos uploaded after this date, since an older video usually cannot spoil you |
| `maxAgeDays` | same idea as a rolling window in days, for hand written packs |
| `ai` | optional on-device meaning matching: `{ "enabled": true, "topics": [...], "threshold": 0.35 }` |

Aliases are what make this work for spoilers: the God of War pack matches `kratos`, `atreus`,
`mimir`, `valkyrie queen` and so on, so clickbait titles that never name the game still get covered.

Matching is done locally in your browser. Nothing is sent anywhere, and no YouTube account access
is needed.

### On-device AI matching (opt-in, per pack)

Keywords miss titles like *"HE FINALLY MEETS HIS SON"*. Switch on **Also hide titles that only
mean the same thing** for a pack and SpoilerGuard compares the meaning of each title against the
pack's topics using [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) (quantized,
~22 MB) running through transformers.js in an offscreen document. Model and runtime are bundled
with the extension, so there is no download at runtime and no server call: titles never leave
the browser.

The slider is the match cutoff (default `0.35`; lower hides more). For reference, against the
topic *god of war ragnarok kratos atreus*: "Kratos and the boy: the final scene" scores 0.49,
"THAT ending broke me..." 0.28, "How to cook rice perfectly" 0.12. If the model fails to load,
keyword matching carries on unaffected.

## Covers

A covered item shows `Hidden · God of War related content`, the video's duration / views / upload
age when YouTube exposes them, and why it matched (`matched keyword: kratos`), with **Reveal** (temporary, default 10
minutes) and **Always allow** (permanent, that video only). The cover also swallows hover, so
YouTube's autoplay preview cannot spoil you either.

## Quick blocking from the page

Right-click any video:

- **block this channel**, which hides everything from it
- **block keywords from this video…**, which lets you pick words out of the title (or type your
  own) and hide them everywhere, not just on that channel
- **always allow this video**

Highlighting text anywhere on YouTube also gives you a *block the words "…"* right-click item.

## Scopes

Home feed, search results, watch-page suggestions, Shorts shelves, channel pages, playlists and
comments can each be toggled independently. Search and comments are off by default: search is
where you deliberately go looking, and comment hiding is for people who want to be extra careful.

## Packs

- Built-in catalog: `packs/index.json`
- The settings page also reads `packs/index.json` from `main` in this repository, so community
  packs appear without shipping an extension update
- Add your own in the settings page, or share one of yours from **Community made lists**, which
  opens a prefilled issue form; see [CONTRIBUTING.md](CONTRIBUTING.md) for the file format

Pack format:

```json
{
  "name": "Elden Ring",
  "label": "Elden Ring related content",
  "terms": ["elden ring", "radahn", "malenia"],
  "channels": ["@SomeSpoilerChannel"],
  "except": ["elden ring lore theory"]
}
```

## Development

```bash
npm test   # unit tests for the matching engine
```

Layout:

- `src/matcher.js` — pure matching engine, shared by every surface, unit tested
- `src/content.js` — finds YouTube tiles/comments and covers them
- `src/background.js` — first-run setup, context menus, badge counter, offscreen AI bridge
- `src/offscreen.*` — runs the embedding model; `src/vendor/`, `models/` — bundled runtime + model
- `src/popup.*`, `src/options.*` — UI
- `packs/` — built-in block packs
