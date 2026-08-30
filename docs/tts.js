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

// Generation counter: bumping it cancels whatever was mid-flight.
let generation = 0;

/**
 * Synthesize the whole text to ONE mp3 Blob (chunks fetched in order and
 * concatenated — MP3 frames join cleanly). Throws on failure — the caller
 * falls back to the system voice.
 */
export async function synthesizeAll(text, { workerUrl, voiceId, rate = 1 } = {}) {
  if (!workerUrl) throw new Error("no worker URL configured");
  const gen = ++generation;
  const parts = [];
  for (const chunk of splitIntoChunks(text)) {
    if (gen !== generation) throw new Error("cancelled");
    parts.push(await fetchChunk(workerUrl, chunk, voiceId, rate));
  }
  return new Blob(parts, { type: "audio/mpeg" });
}

/** Cancel any in-flight synthesis (does not stop already-playing audio). */
export function cancelSynthesis() {
  generation++;
}
