# applypipe

React ✅ to an internship post in Discord → applypipe opens the application in Chrome, fills it from your profile, and stops on the review page. **It never submits; you click Submit yourself.**

Personal, local tool. All personal data lives in `~/.applypipe/` (override with `APPLYPIPE_HOME`), never in this repo.

## Setup

### 1. Install

Requires Node 22.12+ and Google Chrome.

```sh
npm install
```

### 2. Create your data folder

```sh
mkdir -p ~/.applypipe
cp profile.example.yaml ~/.applypipe/profile.yaml
cp env.example ~/.applypipe/.env
cp /path/to/your/resume.pdf ~/.applypipe/resume.pdf
```

Edit `~/.applypipe/profile.yaml`, then check it:

```sh
npm run profile:check
```

### 3. Create the Discord bot

1. Go to <https://discord.com/developers/applications> → **New Application** (any name, e.g. "applypipe").
2. **Bot** tab:
   - **Reset Token** → copy it into `DISCORD_TOKEN` in `~/.applypipe/.env`.
   - Under **Privileged Gateway Intents**, turn on **Message Content Intent** (needed to read the link in the webhook posts). Save.
   - Turning off **Public Bot** is a good idea so only you can invite it.
3. **Installation** tab (or OAuth2 → URL Generator): scope `bot`, with these bot permissions:
   - View Channels
   - Read Message History
   - Add Reactions
   - Send Messages (for the summary DM)

   Or use this URL with your application ID (permissions integer `68672`):

   ```
   https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot&permissions=68672
   ```

   Open it and add the bot to the server that has your jobs channel. If the channel is private, also give the bot access to that channel.
4. In Discord, turn on **Settings → Advanced → Developer Mode**, then:
   - right-click the jobs channel → **Copy Channel ID** → `DISCORD_CHANNEL_ID`
   - right-click your own name → **Copy User ID** → `DISCORD_OWNER_ID`

Only ✅ reactions from `DISCORD_OWNER_ID` in `DISCORD_CHANNEL_ID` queue jobs.

### 4. Run

```sh
npm start
```

On start, applypipe scans the last 14 days (up to 500 messages) of the channel for posts you ✅'d while it was off, then keeps listening. Ctrl-C stops it.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Discord bot (+ worker from Phase 3). Ctrl-C to stop |
| `npm run status` | Jobs by status (last 7 days; `-- --all`, `-- --json`) |
| `npm run profile:check` | Validate `profile.yaml` and the resume file |
| `npm run setup:password` | Store the Workday password in Keychain (Phase 5) |
| `npm test` / `npm run typecheck` | Tests / type check |

## Status emoji on your post

👀 queued · 🔁 duplicate of an existing job · ⏳ filling · 🟢 ready for review · ⚠️ needs you · 📨 submitted · ⏭️ posting closed · ❌ couldn't open (e.g. no link found)

Remove your ✅ while a job is still 👀 to drop it from the queue.

LinkedIn and Indeed links are never opened (their terms forbid automation): ✅ on one gives ⚠️ "apply manually".

## Troubleshooting

- **"Discord login failed … intent"**: turn on Message Content Intent (step 3.2).
- **"can't read channel"**: check `DISCORD_CHANNEL_ID` and that the bot can view the channel and read its history.
- **A post isn't parsed right**: run `LOG_LEVEL=debug npm start` and react ✅; the raw message (content + embeds) is logged as `feed message`. Save it as a fixture in `test/fixtures/discord/` with the expected result.
