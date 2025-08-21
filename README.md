# AutoRejoinVC — BetterDiscord Plugin

> Lock a voice channel and automatically reconnect to it if you leave or get disconnected. One locked channel at a time. Large red/green icon. Progressive backoff for smooth performance.

⚠️ **Disclaimer**: BetterDiscord modifies the official Discord client and may violate Discord’s Terms of Service. Use at your own risk. This project is not affiliated with Discord.

---

## What it does

- Adds a **lock/unlock button** next to every **voice channel** in the channel list.
- While a channel is **locked**, the plugin **auto-reconnects** you to that voice channel whenever you leave or get disconnected.
- **Single locked channel** at any time (locking a new one replaces the previous).
- **Large icon (28px)**: **red** when *unlocked*, **green** when *locked*.
- **Progressive backoff**: reconnection attempts start at **500 ms**, increase up to **3000 ms** when attempts fail, and **reset to 500 ms** as soon as you are back in the channel.
- **Readable Settings panel** (forced light theme) that works well on both Discord light & dark themes.

---

## How it works (under the hood)

- Observes the channel list and injects a small **slot** next to each voice channel entry, rendering a lock/unlock button.
- Uses BetterDiscord’s Webpack access to read:
  - `VoiceStateStore` → detects **your current voice channel**.
  - `ChannelStore` → resolves **guild and channel IDs** reliably (no brittle DOM parsing).
  - Optional `Router` module → **navigates** to `/channels/{guildId}/{channelId}` when the item isn’t in the DOM yet, then **simulates a click** to join.
- No private network calls; the plugin **drives the UI** like a user click would.
- Persists only the **locked target** (`guildId`, `channelId`) using `BdApi.Data`.

---

## Installation

1. Download the plugin file: `AutoRejoinVC.plugin.js` (single file).
2. Put it in your BetterDiscord plugins folder:
   - **Windows**: `%AppData%\BetterDiscord\plugins`
   - **macOS**: `~/Library/Application Support/BetterDiscord/plugins`
   - **Linux**: `~/.config/BetterDiscord/plugins`
3. In Discord: **Settings → BetterDiscord → Plugins**, enable **AutoRejoinVC**.

> Ensure BetterDiscord is installed and enabled. Restart Discord if the plugin doesn’t appear.

---

## Usage

- In your server’s channel list, locate any **voice channel**.
- Click the **red icon** to **lock** it → the icon turns **green**.
- While locked, the plugin checks your voice state and will **bring you back** to that channel when you’re not in it.
- Click the **green icon** to **unlock** (stop auto-reconnect).

---

## Settings

Open **Settings → BetterDiscord → Plugins → AutoRejoinVC → Settings**.

- **Status card**: shows the current locked channel (if any) and an **Unlock** button.
- **Reconnection (progressive backoff)**:
  - **Minimum delay (ms)** — default `500`
  - **Maximum delay (ms)** — default `3000`
  - **Reset (500 / 3000)** — quick preset
  - **Apply** — apply the new bounds. The current delay resets to the minimum on success.

The Settings panel uses a **forced light style** for clarity and stays readable on both Discord themes.

---

## Customization

### Icon size
The plugin defines a CSS variable `--arvc-size` (default `28px`). You can change it by editing the plugin’s CSS or overriding it with Custom CSS:

```css
/* Example: make the icon bigger */
:root { --arvc-size: 32px; }
```

> If your Custom CSS loads before the plugin, prefer editing the value directly in the plugin source (`addStyles()`), or re-declare it after enabling the plugin.

---

## Performance & backoff

- The reconnect loop only **does real work** when a channel is locked **and** you’re **not currently in it**.
- The delay starts at **500 ms**, then multiplies by **×1.7** on each failed attempt, up to **3000 ms**.
- On a **successful join** (or when you’re already in the channel), the delay **resets to 500 ms**.
- This avoids excessive DOM/Router activity and prevents UI stutter.

---

## Limitations & notes

- You must have permission to **connect** to the target voice channel.
- If the channel is **full**, the plugin will keep trying (respecting the backoff).
- **Stage channels** behave as expected: you will join as an audience member.
- If Discord changes its internal selectors or modules, the plugin may need updates.
- The manual “Join now” action was removed from Settings because joining requires the server to be in focus; the auto flow handles this via Router.

---

## Troubleshooting

- **Icon doesn’t show**: reload the plugin; make sure you are viewing a server’s channel list; check for BD/Discord updates.
- **“Unable to identify guild”** (older versions): open the server once so the store has the data. Newer versions resolve the guild via `ChannelStore`.
- **Doesn’t reconnect**: confirm the channel is green (locked), verify permissions, and check your backoff bounds in Settings.

---

## Security & privacy

- **No analytics**, **no external requests**.
- Persists only the **locked channel target** using BetterDiscord’s local storage.
- No token access, no message inspection.

---

## Contributing

Issues and PRs are welcome. Please describe reproduction steps, your OS, Discord build, and BetterDiscord version.

