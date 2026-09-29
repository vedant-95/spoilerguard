# SpoilerGuard for YouTube

Covers spoilery or unwanted YouTube thumbnails and titles behind a "privacy cover" until you
choose to reveal them. Searching for one God of War walkthrough should not hand you the ending in
your recommendations.

## Install (no Chrome Web Store needed)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. The settings page opens. Switch on the **God of War** pack (or add your own words), then open
   YouTube.

## How it decides what to hide

For every video tile on the page, SpoilerGuard reads the title, channel name and handle *before*
you look at it, and compares them against your active **block packs**. A pack is a plain list of:

| Field | Meaning |
| --- | --- |
| `terms` | words / phrases to hide, matched on whole words so `gow` never matches `Glasgow` |
| `channels` | channel names or `@handles` to hide entirely |
| `regex` | optional advanced patterns |
| `except` | words that cancel a match (e.g. hide `ragnarok` but not `thor ragnarok`) |
| `expiresAt` | pack switches itself off on this date — "block until I finish the game" |

Aliases are what make this work for spoilers: the God of War pack matches `kratos`, `atreus`,
`mimir`, `valkyrie queen` and so on, so clickbait titles that never name the game still get covered.

Matching is done locally in your browser. Nothing is sent anywhere, and no YouTube account access
is needed.

## Covers

A covered item shows `Hidden · God of War related content` with **Reveal** (temporary, default 10
minutes) and **Always allow** (permanent, that video only). The cover also swallows hover, so
YouTube's autoplay preview cannot spoil you either.

## Quick blocking from the page

Right-click any video:

- **block this channel** — hides everything from it
- **block keywords from this video…** — pick words out of the title (or type your own) and hide
  them everywhere, not just on that channel
- **always allow this video**

Highlighting text anywhere on YouTube also gives you a *block the words "…"* right-click item.

## Scopes

Home feed, search results, watch-page suggestions, Shorts shelves, channel pages, playlists and
comments can each be toggled independently. Search and comments are off by default — search is
where you deliberately go looking, and comment hiding is for people who want to be extra careful.

## Packs

- Built-in catalog: `packs/index.json`
- Add your own in the settings page, or import a pack by pasting JSON or a link to a `.json` file
- Export any pack to share it

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
- `src/background.js` — first-run setup, context menus, badge counter
- `src/popup.*`, `src/options.*` — UI
- `packs/` — built-in block packs
