# Spanish Voice Tutor Bot 🇪🇸

Telegram bot for practicing Spanish. Send a voice message → the AI tutor
transcribes it, gently corrects mistakes, and replies **with a voice message**
in a native Spanish voice of your choice.

All services are free:
- **STT + LLM** — [Groq](https://console.groq.com) free tier (Whisper `whisper-large-v3-turbo`, chat `llama-3.3-70b-versatile`)
- **TTS** — [edge-tts](https://github.com/rany2/edge_tts) (Microsoft neural voices, no API key)

## Setup

1. **Python 3.10+**, then:
   ```
   pip install -r requirements.txt
   ```
2. **ffmpeg** must be on your PATH (voice notes must be OGG/OPUS):
   - Windows: `winget install Gyan.FFmpeg` (restart terminal)
3. **Telegram bot token** — talk to [@BotFather](https://t.me/BotFather), `/newbot`, copy the token.
4. **Groq API key** — create one at [console.groq.com/keys](https://console.groq.com/keys) (free, no card).
5. ```
   cp .env.example .env   # then fill in both keys
   ```

## Run

```
python bot.py
```

Message your bot: `/start`, `/voice` to pick an accent, then just talk.

## Commands

| Command | What it does |
|---|---|
| `/start` | Welcome message |
| `/voice` | Choose one of 6 native voices (🇲🇽 🇪🇸 🇦🇷 🇨🇴) |
| `/reset` | Start a fresh conversation |

Text messages also work — you'll still get a voice reply.

## Notes
- Per-user state (voice choice + last 10 messages) lives in `users/*.json`.
- edge-tts is an unofficial free Microsoft endpoint; if it ever breaks,
  swap `tts.py` for Google Cloud TTS free tier with minimal changes.

## Web version (`web/`)

The same tutor as a static website, deployable on **GitHub Pages** with no backend.

- **No secrets in the site (BYOK):** each visitor enters their own free Groq API
  key in ⚙️ Ajustes. It's kept in `localStorage` and only ever sent to
  `api.groq.com` directly from the browser. The repo ships zero keys.
- **Voice input:** Web Speech API `SpeechRecognition` (Chrome/Edge; not
  supported in Firefox or desktop Safari).
- **Voice replies:** Web Speech API `speechSynthesis` using your system's
  Spanish voices — free and offline. Toggle 🔊/💬 in the header to switch
  between voice and text replies.

### Deploy
1. Push this repo to GitHub.
2. Repo → Settings → Pages → Source: `main`, folder `/web`.
3. Open the published URL, click ⚙️, paste a key from
   [console.groq.com/keys](https://console.groq.com/keys), pick a voice, done.

### Run locally
```
python -m http.server -d web
# open http://localhost:8000
```

