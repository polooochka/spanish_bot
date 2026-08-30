"""Speech-to-text via Groq's free-tier Whisper API."""

import os

from groq import Groq

_client = Groq(api_key=os.environ["GROQ_API_KEY"])


def transcribe(ogg_path: str) -> str:
    """Transcribe a Spanish voice note (OGG/OPUS) to text."""
    with open(ogg_path, "rb") as f:
        response = _client.audio.transcriptions.create(
            model="whisper-large-v3-turbo",
            file=f,
            language="es",
        )
    return response.text.strip()
