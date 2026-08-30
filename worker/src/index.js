// Cloudflare Worker: relays text to Microsoft's free edge-tts service and
// returns MP3 audio. Holds no secrets; the upstream endpoint needs no key.
// A browser page can't call edge-tts directly because the endpoint demands
// an Origin: chrome-extension://... header that browsers refuse to set.

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_VERSION = "143.0.3650.75";
const WSS_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

const ALLOWED_VOICES = new Set([
  "es-MX-DaliaNeural",
  "es-MX-JorgeNeural",
  "es-ES-ElviraNeural",
  "es-ES-AlvaroNeural",
  "es-AR-ElenaNeural",
  "es-CO-SalomeNeural",
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Same voices as the Telegram bot's /voice menu.
function jsDate() {
  return new Date().toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)");
}

async function secMsGec() {
  const ticks =
    (BigInt(Math.floor(Date.now() / 1000)) + 11644473600n) * 10000000n;
  const rounded = ticks - (ticks % 3000000000n);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${rounded}${TRUSTED_CLIENT_TOKEN}`)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function requestId() {
  return crypto.randomUUID().replace(/-/g, "");
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function synthesize(text, voice, rate) {
  const gec = await secMsGec();
  const url =
    `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=1-${CHROMIUM_VERSION}`;

  // Workers' WebSocket constructor can't set headers — upgrade via fetch
  // (which wants an https:// URL, not wss://).
  const upstream = await fetch(url.replace("wss://", "https://"), {
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))),
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
      Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
    },
  });
  if (!upstream.webSocket) throw new Error("upgrade failed");

  return new Promise((resolve, reject) => {
    const ws = upstream.webSocket;
    ws.accept();
    ws.binaryType = "arraybuffer";
    const chunks = [];
    let settled = false;
    const fail = (msg) => {
      if (!settled) {
        settled = true;
        reject(new Error(msg));
      }
      try { ws.close(); } catch {}
    };
    ws.onerror = () => fail("upstream connection failed");
    ws.onclose = () => {
      if (!settled) fail("upstream closed early");
    };
    ws.onopen = () => {
      const timestamp = jsDate();
      ws.send(
        `X-Timestamp:${timestamp}\r\n` +
          "Content-Type:application/json; charset=utf-8\r\n" +
          "Path:speech.config\r\n\r\n" +
          '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
          '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},' +
          '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
      );
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='es-ES'>` +
        `<voice name='${voice}'>` +
        `<prosody rate='${rate >= 1 ? "+" : ""}${Math.round((rate - 1) * 100)}%'>` +
        `${escapeXml(text)}` +
        `</prosody></voice></speak>`;
      ws.send(
        `X-RequestId:${requestId()}\r\n` +
          "Content-Type:application/ssml+xml\r\n" +
          `X-Timestamp:${timestamp}Z\r\n` + // trailing Z is an Edge bug we replicate
          "Path:ssml\r\n\r\n" + ssml
      );
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        if (e.data.includes("Path:turn.end")) {
          settled = true;
          ws.close();
          resolve(new Blob(chunks, { type: "audio/mpeg" }));
        }
        return;
      }
      const view = new DataView(e.data);
      const headerLen = view.getUint16(0);
      const header = new TextDecoder().decode(
        new Uint8Array(e.data, 2, headerLen)
      );
      if (header.includes("Path:audio")) {
        chunks.push(new Uint8Array(e.data.slice(2 + headerLen)));
      }
    };
  });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    const url = new URL(request.url);
    if (url.pathname !== "/tts") {
      return new Response("not found", { status: 404, headers: CORS });
    }
    const text = (url.searchParams.get("text") || "").slice(0, 500);
    const voice = url.searchParams.get("voice") || "es-MX-DaliaNeural";
    const rate = Math.min(1.5, Math.max(0.5, parseFloat(url.searchParams.get("rate")) || 1));
    if (!text || !ALLOWED_VOICES.has(voice)) {
      return new Response("bad request", { status: 400, headers: CORS });
    }
    try {
      const mp3 = await synthesize(text, voice, rate);
      return new Response(mp3, {
        headers: {
          ...CORS,
          "Content-Type": "audio/mpeg",
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch (err) {
      return new Response(`tts failed: ${err.message}`, {
        status: 502,
        headers: CORS,
      });
    }
  },
};
