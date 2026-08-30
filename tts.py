"""Text-to-speech via edge-tts (free Microsoft neural voices)."""

import asyncio
import io

import edge_tts

# Preset native Spanish voices offered in the /voice menu.
VOICES = {
    "dalia":   ("🇲🇽 Dalia (México ♀)", "es-MX-DaliaNeural"),
    "jorge":   ("🇲🇽 Jorge (México ♂)", "es-MX-JorgeNeural"),
    "elvira":  ("🇪🇸 Elvira (España ♀)", "es-ES-ElviraNeural"),
    "alvaro":  ("🇪🇸 Álvaro (España ♂)", "es-ES-AlvaroNeural"),
    "elena":   ("🇦🇷 Elena (Argentina ♀)", "es-AR-ElenaNeural"),
    "salome":  ("🇨🇴 Salomé (Colombia ♀)", "es-CO-SalomeNeural"),
}

DEFAULT_VOICE_KEY = "dalia"


def get_voice_id(key: str) -> str:
    return VOICES.get(key, VOICES[DEFAULT_VOICE_KEY])[1]


async def synthesize(text: str, voice_id: str) -> bytes:
    """Synthesize text to an in-memory MP3 buffer."""
    mp3 = io.BytesIO()
    communicate = edge_tts.Communicate(text, voice_id)
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            mp3.write(chunk["data"])
    return mp3.getvalue()


if __name__ == "__main__":
    data = asyncio.run(synthesize("Hola, ¿cómo estás?", get_voice_id(DEFAULT_VOICE_KEY)))
    with open("test_voice.mp3", "wb") as f:
        f.write(data)
    print(f"wrote test_voice.mp3 ({len(data)} bytes)")
