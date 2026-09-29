# Share a block list

Block lists in this repository show up inside the extension under **Ready made block lists**, so
anyone can add yours in one click. The extension reads `packs/index.json` straight from `main`,
which means a merged pull request is live for everyone without waiting for a new release.

## Add one

1. Create `packs/<your-list>.json` using the shape below.
2. Add an entry for it to `packs/index.json`.
3. Open a pull request.

```json
{
  "id": "elden-ring",
  "name": "Elden Ring",
  "description": "Bosses, endings and late game areas.",
  "author": "your-github-name",
  "label": "Elden Ring spoilers",
  "terms": ["elden ring", "radahn", "malenia", "erdtree"],
  "channels": ["@SomeSpoilerChannel"],
  "except": ["elden ring build guide"],
  "ai": { "enabled": false, "topics": ["a lone knight fights demigods in the lands between"] }
}
```

| Field | What it does |
| --- | --- |
| `id` | unique, lowercase, dashes instead of spaces |
| `name` | what the list is called in settings |
| `description` | one line shown next to the Add button |
| `label` | the words shown on the cover in place of the video |
| `terms` | words and phrases that hide a video, matched as whole words |
| `channels` | channel names or `@handles` to hide outright |
| `except` | words that keep a video visible even when something above matched |
| `ai` | optional topic sentences for the on device AI, off unless the person turns it on |

## What makes a good list

- **Aliases matter more than the obvious name.** Spoilers rarely say "God of War", they say
  "Kratos" or "Ragnarok", so include the characters, places, bosses and nicknames.
- **Add exceptions for the collisions you can predict.** `ragnarok` also means Thor, and `gow`
  appears inside Glasgow, so add the phrases that should stay visible.
- **Keep one topic per list.** People switch lists on and off individually.
- **No slurs, harassment targets, or lists aimed at silencing a person.** Topic lists only.

Lists are plain text and run entirely on the reader's own machine. Nothing in a list is sent
anywhere, and the extension never uploads what anybody watches.
