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

import { VOICES, synthesize } from "./edge-tts.js";
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
// Primary: edge-tts (same neural voices as the Telegram bot, free, no key).
// Fallback: browser speechSynthesis with system Spanish voices.
let currentAudio = null;

function speakWithEdge(text, voiceId, rate) {
  return synthesize(text, voiceId, rate).then((blob) => {
    currentAudio?.pause();
    currentAudio = new Audio(URL.createObjectURL(blob));
    return currentAudio.play();
  });
}

function speakWithSystem(text) {
  if (!("speechSynthesis" in window)) return;
  const uri = store.get("system_voice_uri", "");
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "es-ES";
  const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === uri);
  if (voice) utter.voice = voice;
  utter.rate = parseFloat(store.get("rate", "1"));
  speechSynthesis.speak(utter);
}

function speakText(text) {
  const clean = text.replace(/\([^)]*\)/g, " "); // skip correction notes
  const voiceId = VOICES[store.get("voice_key", "dalia")][1];
  const rate = parseFloat(store.get("rate", "1"));
  speechSynthesis.cancel();
  speakWithEdge(clean, voiceId, rate).catch(() => speakWithSystem(clean));
}

// ---------- stt ----------
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recording = false;
let pendingLocales = []; // locales left to try when one is rejected
let gotResult = false;

const ES_LOCALES = ["es-ES", "es", "es-MX", "es-US"]; // first accepted one is remembered

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = store.get("stt_locale", "es-ES");
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onresult = (e) => {
    gotResult = true;
    let transcript = "";
    for (const r of e.results) transcript += r[0].transcript;
    inputEl.value = transcript;
    if (e.results[e.results.length - 1].isFinal) sendUserMessage(transcript);
  };
  recognition.onerror = (e) => {
    // Some browser/OS combos reject certain locale tags — try the next one.
    if (e.error === "language-not-supported" && pendingLocales.length) {
      recognition.lang = pendingLocales.shift();
      store.set("stt_locale", recognition.lang);
      try {
        recognition.start();
        return;
      } catch {}
    }
    if (e.error !== "aborted" && e.error !== "no-speech") {
      addBubble("assistant", `No pude escucharte (${e.error}). Intenta de nuevo.`, { error: true });
    }
  };
  recognition.onend = () => {
    recording = false;
    $("micBtn").classList.remove("recording");
  };
}

$("micBtn").addEventListener("click", () => {
  if (!recognition) {
    addBubble(
      "assistant",
      "Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge, o escribe tu mensaje.",
      { error: true }
    );
    return;
  }
  if (recording) {
    recognition.stop();
  } else {
    speechSynthesis.cancel();
    // Build retry list: remembered locale first, then the other Spanish tags.
    const saved = store.get("stt_locale", "es-ES");
    recognition.lang = saved;
    pendingLocales = ES_LOCALES.filter((l) => l !== saved);
    gotResult = false;
    recording = true;
    $("micBtn").classList.add("recording");
    inputEl.value = "";
    inputEl.placeholder = "🎧 Escuchando…";
    recognition.start();
    setTimeout(() => (inputEl.placeholder = "Escribe en español…"), 100);
  }
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
  $("settingsModal").classList.remove("hidden");
}
$("settingsBtn").addEventListener("click", openSettings);
$("closeSettingsBtn").addEventListener("click", () => {
  store.set("groq_key", $("apiKey").value.trim());
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
speechSynthesis.onvoiceschanged = () => {}; // system voices only used as fallback

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
