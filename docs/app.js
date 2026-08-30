// Spanish tutor web app — static, BYOK (user's Groq key stays in localStorage).
"use strict";

const SYSTEM_PROMPT =
  "Eres un tutor de español amable y paciente. El usuario está aprendiendo español. " +
  "Responde SIEMPRE en español, con frases cortas y claras (2 a 4 frases máximo). " +
  "Si el usuario comete errores, primero corrígelos brevemente entre paréntesis " +
  "y después continúa la conversación de forma natural. " +
  "Mantén una conversación interesante: haz preguntas sencillas sobre su día, " +
  "gustos o planes. Nunca uses markdown ni emojis.";

const MODEL = "openai/gpt-oss-120b";

import { VOICES, speak as speakEdge, stopSpeaking } from "./tts.js";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const HISTORY_LIMIT = 10;

// ---------- state ----------
const store = {
  get(key, fallback) {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  },
  set(key, value) {
    localStorage.setItem(key, value);
  },
};

let history = []; // [{role, content}] — system prompt is prepended on each call
try {
  history = JSON.parse(store.get("chat_history", "[]"));
} catch {
  history = [];
}

let replyMode = store.get("reply_mode", "voice"); // "voice" | "text"

// ---------- dom ----------
const $ = (id) => document.getElementById(id);
const chatEl = $("chat");
const inputEl = $("msgInput");
const statusEl = $("status");
const modeBtn = $("replyModeBtn");

// ---------- chat rendering ----------
function addBubble(role, text, { typing = false, error = false } = {}) {
  const div = document.createElement("div");
  div.className = `bubble ${role}${typing ? " typing" : ""}${error ? " error" : ""}`;
  div.textContent = text;

  if (role === "assistant" && !typing) {
    const speak = document.createElement("span");
    speak.className = "speak-again";
    speak.title = "Escuchar de nuevo";
    speak.textContent = "🔊";
    speak.addEventListener("click", () => speakText(text));
    div.appendChild(speak);
  }

  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
  return div;
}

function renderHistory() {
  for (const m of history) addBubble(m.role, m.content);
  if (!history.length) {
    addBubble(
      "assistant",
      "¡Hola! 👩‍🏫 Soy tu tutor de español. Escríbeme o presiona 🎤 y háblame en español."
    );
  }
}

// ---------- llm ----------
async function chat(messages) {
  const key = store.get("groq_key", "");
  if (!key) {
    openSettings();
    throw new Error("Falta la API key. Ábrela en ⚙️ Ajustes.");
  }
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 300,
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Groq ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function sendUserMessage(text) {
  text = text.trim();
  if (!text) return;

  addBubble("user", text);
  history.push({ role: "user", content: text });
  history = history.slice(-HISTORY_LIMIT);

  const typing = addBubble("assistant", "escribiendo…", { typing: true });
  statusEl.textContent = "escribiendo…";

  try {
    const answer = await chat(history);
    typing.remove();
    addBubble("assistant", answer);
    history.push({ role: "assistant", content: answer });
    history = history.slice(-HISTORY_LIMIT);
    store.set("chat_history", JSON.stringify(history));
    if (replyMode === "voice") speakText(answer);
  } catch (err) {
    typing.remove();
    addBubble("assistant", `Error: ${err.message}`, { error: true });
  } finally {
    statusEl.textContent = "en línea";
    inputEl.focus();
  }
}

// ---------- tts ----------
// Primary: edge-tts via our free Cloudflare Worker (see worker/).
// Fallback: system Spanish voices.

function speakWithSystem(text, rate) {
  if (!("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "es-ES";
  utter.rate = rate;
  speechSynthesis.speak(utter);
}

function speakText(text) {
  const clean = text.replace(/\([^)]*\)/g, " "); // skip correction notes
  const rate = parseFloat(store.get("rate", "1"));
  const voiceId = VOICES[store.get("voice_key", "dalia")][1];
  const workerUrl = store.get("worker_url", "");
  stopSpeaking();
  speechSynthesis.cancel();
  speakEdge(clean, { workerUrl, voiceId, rate }).catch(() =>
    speakWithSystem(clean, rate)
  );
}

// ---------- stt ----------
// MediaRecorder + Groq Whisper — same free STT as the Telegram bot.
// Works on Windows/Android in Chrome, Edge and Firefox; no OS language packs
// needed. Recording: first tap starts, second tap stops and sends.
let mediaRecorder = null;
let audioChunks = [];
let recording = false;

async function transcribeBlob(blob) {
  const key = store.get("groq_key", "");
  if (!key) throw new Error("Falta la API key (⚙️ Ajustes).");
  const ext = blob.type.includes("mp4") ? "mp4" : "webm";
  const form = new FormData();
  form.append("file", blob, `audio.${ext}`);
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "es");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json();
  return (data.text || "").trim();
}

$("micBtn").addEventListener("click", async () => {
  if (recording) {
    mediaRecorder?.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    addBubble(
      "assistant",
      "Tu navegador no soporta grabación de audio. Actualiza tu navegador o escribe tu mensaje.",
      { error: true }
    );
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    addBubble("assistant", `No tengo acceso al micrófono (${err.name}). Revisa los permisos.`, { error: true });
    return;
  }

  speechSynthesis.cancel();
  audioChunks = [];
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "";
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  recording = true;
  $("micBtn").classList.add("recording");
  inputEl.placeholder = "🎧 Habla… toca de nuevo para enviar";

  mediaRecorder.ondataavailable = (e) => e.data.size && audioChunks.push(e.data);
  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    recording = false;
    $("micBtn").classList.remove("recording");
    inputEl.placeholder = "Transcribiendo…";

    const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
    try {
      const text = await transcribeBlob(blob);
      if (text) {
        await sendUserMessage(text);
      } else {
        addBubble("assistant", "No escuché nada. Intenta de nuevo. 🙏", { error: true });
      }
    } catch (err) {
      addBubble("assistant", `No pude transcribir: ${err.message}`, { error: true });
    } finally {
      inputEl.value = "";
      inputEl.placeholder = "Escribe en español…";
    }
  };
  mediaRecorder.start();
});

// ---------- input ----------
$("sendBtn").addEventListener("click", () => {
  sendUserMessage(inputEl.value);
  inputEl.value = "";
});
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    sendUserMessage(inputEl.value);
    inputEl.value = "";
  }
});

// ---------- reply mode toggle ----------
function renderModeBtn() {
  modeBtn.textContent = replyMode === "voice" ? "🔊 Voz" : "💬 Texto";
}
modeBtn.addEventListener("click", () => {
  replyMode = replyMode === "voice" ? "text" : "voice";
  store.set("reply_mode", replyMode);
  renderModeBtn();
  if (replyMode === "text") speechSynthesis.cancel();
});

// ---------- settings ----------
function openSettings() {
  $("apiKey").value = store.get("groq_key", "");
  $("workerUrl").value = store.get("worker_url", "");
  $("settingsModal").classList.remove("hidden");
}
$("settingsBtn").addEventListener("click", openSettings);
$("closeSettingsBtn").addEventListener("click", () => {
  store.set("groq_key", $("apiKey").value.trim());
  store.set("worker_url", $("workerUrl").value.trim().replace(/\/$/, ""));
  store.set("voice_key", $("voiceSelect").value);
  store.set("rate", $("rateRange").value);
  $("settingsModal").classList.add("hidden");
});
$("clearChatBtn").addEventListener("click", () => {
  history = [];
  store.set("chat_history", "[]");
  chatEl.innerHTML = "";
  renderHistory();
  $("settingsModal").classList.add("hidden");
});

function populateVoices() {
  const select = $("voiceSelect");
  select.innerHTML = "";
  for (const [key, [label]] of Object.entries(VOICES)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = label;
    select.appendChild(opt);
  }
  const saved = store.get("voice_key", "dalia");
  select.value = VOICES[saved] ? saved : "dalia";
}
speechSynthesis.onvoiceschanged = populateVoices; // system voice list loads async

$("rateRange").addEventListener("input", (e) => {
  $("rateVal").textContent = parseFloat(e.target.value).toFixed(2).replace(/0$/, "");
});

// ---------- init ----------
renderHistory();
renderModeBtn();
populateVoices();
$("rateRange").value = store.get("rate", "1");
$("rateVal").textContent = store.get("rate", "1") + "x";
inputEl.focus();
