// Text-to-speech for the web tutor.
//
// Primary: Google Translate TTS — a natural Spanish voice, no API key, works
//   from any static page (played via <audio>, so CORS doesn't apply). Long
//   texts are split into chunks and played back-to-back.
//
// Not used: Microsoft edge-tts (the Telegram bot's engine) — its endpoint
// requires an Origin: chrome-extension://... header that browsers refuse to
// set, so it cannot be called from a web page. See git history.
"use strict";

const GTTS_URL = "https://translate.google.com/translate_tts";

function splitIntoChunks(text, maxLen = 180) {
  // Split on sentence boundaries where possible, then hard-wrap long ones.
  const sentences = text.match(/[^.!?…]+[.!?…]*/g) || [text];
  const chunks = [];
  let current = "";
  for (let s of sentences) {
    if ((current + s).length > maxLen && current) {
      chunks.push(current);
      current = "";
    }
    while (s.length > maxLen) {
      let cut = s.lastIndexOf(" ", maxLen);
      if (cut <= 0) cut = maxLen;
      chunks.push(s.slice(0, cut));
      s = s.slice(cut).trimStart();
    }
    current += s;
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

// Generation counter: bumping it cancels whatever was mid-playback.
let generation = 0;

/**
 * Speak text aloud. Best-effort — resolves when done or when cancelled.
 */
export async function speak(text, rate = 1) {
  const gen = ++generation;
  for (const chunk of splitIntoChunks(text)) {
    if (gen !== generation) return; // superseded by a newer request
    const url = `${GTTS_URL}?ie=UTF-8&client=tw-ob&tl=es&q=` + encodeURIComponent(chunk);
    await new Promise((resolve) => {
      const audio = new Audio(url);
      audio.playbackRate = rate;
      audio.onended = resolve;
      audio.onerror = resolve; // skip bad chunk rather than break the chat
      audio.play().catch(resolve);
    });
  }
}

/** Cancel any in-flight playback. */
export function stopSpeaking() {
  generation++;
}
