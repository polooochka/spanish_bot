// Text-to-speech for the web tutor, backed by our free Cloudflare Worker
// (worker/) which relays Microsoft edge-tts — the same neural voices as the
// Telegram bot. The browser can't call edge-tts directly (the endpoint demands
// an Origin: chrome-extension://... header), and Google's TTS 404s requests
// carrying a non-Google Origin, so a tiny keyless Worker bridges the gap.
//
// Fallback of last resort: system speechSynthesis.
"use strict";

// Same preset voices as the Telegram bot's /voice menu.
export const VOICES = {
  dalia:  ["🇲🇽 Dalia (México ♀)",    "es-MX-DaliaNeural"],
  jorge:  ["🇲🇽 Jorge (México ♂)",    "es-MX-JorgeNeural"],
  elvira: ["🇪🇸 Elvira (España ♀)",   "es-ES-ElviraNeural"],
  alvaro: ["🇪🇸 Álvaro (España ♂)",   "es-ES-AlvaroNeural"],
  elena:  ["🇦🇷 Elena (Argentina ♀)", "es-AR-ElenaNeural"],
  salome: ["🇨🇴 Salomé (Colombia ♀)",  "es-CO-SalomeNeural"],
};

function splitIntoChunks(text, maxLen = 400) {
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

async function fetchChunk(workerUrl, chunk, voiceId, rate) {
  const url =
    `${workerUrl.replace(/\/$/, "")}/tts?text=` + encodeURIComponent(chunk) +
    `&voice=${encodeURIComponent(voiceId)}&rate=${rate}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`worker ${res.status}`);
  const blob = await res.blob();
  if (blob.size < 100) throw new Error("empty audio");
  return blob;
}

// Generation counter: bumping it cancels whatever was mid-playback.
let generation = 0;

/**
 * Speak text aloud with edge-tts via the Worker. Throws on failure —
 * the caller falls back to the system voice.
 */
export async function speak(text, { workerUrl, voiceId, rate = 1 } = {}) {
  if (!workerUrl) throw new Error("no worker URL configured");
  const gen = ++generation;
  const chunks = splitIntoChunks(text);
  for (let i = 0; i < chunks.length; i++) {
    if (gen !== generation) return; // superseded by a newer request
    const blob = await fetchChunk(workerUrl, chunks[i], voiceId, rate);
    if (gen !== generation) return;
    await new Promise((resolve) => {
      const audio = new Audio(URL.createObjectURL(blob));
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
