# Chrome Web Store listing

Everything to paste into the Chrome Web Store developer dashboard, field by field.

## Before you start

1. Sign up at https://chrome.google.com/webstore/devconsole (one-time $5 fee, uses your Google account).
2. Build the upload file: `npm run package`. This creates `spoilerguard-<version>.zip` with only the
   files the extension needs.
3. In the dashboard click **New item** and upload that zip.

## Store listing tab

**Name** (comes from the manifest): SpoilerGuard for YouTube

**Summary** (from the manifest, max 132 characters):
Covers spoilery or unwanted YouTube thumbnails and titles until you choose to reveal them.

**Description:**

```
Ever looked up one thing about a game, a match or a show, and then YouTube filled your home page with videos that gave the ending away?

SpoilerGuard stops that. Tell it what you do not want to see, and it puts a grey cover over any matching video before you see the title or the picture. When you are ready, click Show me.

WHAT IT DOES
- Hide by word: add words like "world cup final" and every video that mentions them is covered.
- Hide a whole channel: right click a video and pick SpoilerGuard: hide this channel.
- AI powered hiding: also catches titles that mean the same thing without using your words.
- Stops on its own: pick the day you will have caught up, and the list switches itself off.
- Only new videos: an old video cannot spoil last night's match, so it can leave those alone.
- Community made lists: use a list someone else already wrote, or share yours.

YOU ARE IN CHARGE
- Choose where it hides things: Home, search, Shorts, channel pages, playlists, comments, and the videos next to the one you are watching.
- Every cover shows why it was hidden, with Show me for a quick look and Always show for a video you are happy to see.
- Pause it for 15 minutes or an hour from the toolbar.

YOUR VIEWING STAYS YOURS
No account and no sign in. SpoilerGuard never sends what you watch or search for to anyone, including us. Your lists stay in your own browser.

SpoilerGuard is free, with no ads and no tracking. It is not made by or connected to YouTube.
```

**Category:** Productivity > Tools (Lifestyle > Entertainment also fits; pick one)

**Language:** English

**Store icon (128x128):** `icons/icon128.png`

**Screenshots (1280x800, upload in this order):**
1. `store/screenshots/1-covered.png`
2. `store/screenshots/2-everywhere.png`
3. `store/screenshots/3-lists.png`
4. `store/screenshots/4-community.png`
5. `store/screenshots/5-private.png`

**Small promo tile (440x280):** `store/promo-small-440x280.png`

**Marquee promo tile (1400x560, optional):** `store/promo-marquee-1400x560.png`

**Official URL:** leave empty (needs a verified domain you own)

**Homepage URL:** https://vedant-95.github.io/spoilerguard/

**Support URL:** https://github.com/vedant-95/spoilerguard/issues

## Privacy practices tab

**Single purpose:**

```
SpoilerGuard covers YouTube video titles and thumbnails that match words, channels or topics the user chose, so they do not see spoilers or content they want to avoid until they decide to reveal it.
```

**Permission justifications:**

| Permission | Paste this |
| --- | --- |
| `storage` | Saves the user's lists of words and channels, their settings, and the videos they chose to always show, on their own computer. |
| `contextMenus` | Adds "hide this channel", "hide words from this video" and "always show this video" to the right-click menu on YouTube, so users can add something to a list without opening settings. |
| `offscreen` | Runs the optional AI powered hiding, which compares video titles with the user's topics. It runs inside the browser and the model ships with the extension, so titles are never sent anywhere. |
| Host permission `https://www.youtube.com/*` | Needed to read video titles and channel names on YouTube pages and place a cover over the ones that match the user's lists. The extension does nothing on any other site. |
| Host permission `https://raw.githubusercontent.com/vedant-95/spoilerguard/*` | Downloads the public catalog of community made lists from the extension's own GitHub repository. No user data is sent. |

**Are you using remote code?** No, I am not using remote code.
(Community lists are plain JSON data, not code. All JavaScript, the AI model and its runtime ship inside the zip.)

**Data usage:** tick none of the data types. SpoilerGuard does not collect or transmit any user data.
Then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://vedant-95.github.io/spoilerguard/privacy.html

## Distribution tab

- **Payments:** Free
- **Visibility:** Public (or Unlisted if you want to test with friends first)
- **Regions:** All regions

## After you submit

Review usually takes a few days. Once it is live, replace the "Get SpoilerGuard" link on the landing
page with the store link, and use the dashboard's Analytics tab to see installs and weekly users.

To ship an update later: bump `version` in `manifest.json`, run `npm run package`, then upload the new
zip under **Package** in the dashboard. Users keep their lists when the store updates them.
