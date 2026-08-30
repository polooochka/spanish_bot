"""Groq-powered Spanish tutor chat."""

import os

from groq import Groq

SYSTEM_PROMPT = (
    "Eres un tutor de español amable y paciente. El usuario está aprendiendo español. "
    "Responde SIEMPRE en español, con frases cortas y claras (2 a 4 frases máximo). "
    "Si el usuario comete errores, primero corrígelos brevemente entre paréntesis "
    "y después continúa la conversación de forma natural. "
    "Mantén una conversación interesante: haz preguntas sencillas sobre su día, "
    "gustos o planes. Nunca uses markdown ni emojis."
)

_client = Groq(api_key=os.environ["GROQ_API_KEY"])
MODEL = "openai/gpt-oss-120b"


def reply(history: list[dict]) -> str:
    """Given a message history [{role, content}, ...], get the tutor's reply."""
    response = _client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "system", "content": SYSTEM_PROMPT}, *history],
        max_tokens=300,
        temperature=0.7,
    )
    return response.choices[0].message.content.strip()
