// edge-tts in the browser: talks to Microsoft's free read-aloud WebSocket
// (same service the Telegram bot's edge-tts package uses). No API key.
// Requires a secure context (https / localhost) for crypto.subtle.
"use strict";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const CHROMIUM_VERSION = "130.0.2849.68";

// Same preset voices as the Telegram bot.
export const VOICES = {
  dalia:  ["🇲🇽 Dalia (México ♀)",      "es-MX-DaliaNeural"],
  jorge:  ["🇲🇽 Jorge (México ♂)",      "es-MX-JorgeNeural"],
  elvira: ["🇪🇸 Elvira (España ♀)",     "es-ES-ElviraNeural"],
  alvaro: ["🇪🇸 Álvaro (España ♂)",     "es-ES-AlvaroNeural"],
  elena:  ["🇦🇷 Elena (Argentina ♀)",   "es-AR-ElenaNeural"],
  salome: ["🇨🇴 Salomé (Colombia ♀)",    "es-CO-SalomeNeural"],
};

async function secMsGec() {
  // DRM token: SHA-256 of (Windows-epoch ticks rounded to 5 min + client token).
  const ticks = ((Date.now() / 1000 + 11644473600) * 30000000 / 100 * 100) | 0;
  const rounded = ticks - (ticks % 3000000000);
  const data = new TextEncoder().encode(`${rounded}${TRUSTED_CLIENT_TOKEN}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Synthesize text to an MP3 Blob. Throws on failure — callers should fall
 * back to speechSynthesis.
 */
export async function synthesize(text, voiceId, rate = 1.0) {
  const gec = await secMsGec();
  const url =
    `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=1-${CHROMIUM_VERSION}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    let mp3 = [];
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      reject(err);
    };
    ws.onerror = () => fail(new Error("edge-tts connection failed"));
    ws.onclose = () => {
      if (!settled) fail(new Error("edge-tts connection closed early"));
    };

    ws.onopen = () => {
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='es-ES'>` +
        `<voice name='${voiceId}'>` +
        `<prosody rate='${rate.toFixed(2)}'>${escapeXml(text)}</prosody>` +
        `</voice></speak>`;
      ws.send(
        `X-TTS:${JSON.stringify({
          "speech.config": {
            outputFormat: "audio-24khz-48kbitrate-mono-mp3",
            context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" } } } },
          },
        })}\r\n`
      );
      ws.send(`ssml:${ssml}\r\n`);
    };

    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        if (e.data.includes("Path:turn.end")) {
          settled = true;
          ws.close();
          resolve(new Blob(mp3, { type: "audio/mpeg" }));
        }
        return;
      }
      // Binary frame: 2-byte BE header length, then header text, then audio.
      const view = new DataView(e.data);
      const headerLen = view.getUint16(0);
      const header = new TextDecoder().decode(new Uint8Array(e.data, 2, headerLen));
      if (header.includes("Path:audio")) {
        mp3.push(new Uint8Array(e.data, 2 + headerLen));
      }
    };
  });
}
