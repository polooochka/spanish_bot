"""Per-user state stored as JSON files in ./users/ (no database needed)."""

import json
import os
from threading import Lock

from tts import DEFAULT_VOICE_KEY

USER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "users")
HISTORY_LIMIT = 10  # messages kept per user

_lock = Lock()


def _path(user_id: int) -> str:
    return os.path.join(USER_DIR, f"{user_id}.json")


def _load(user_id: int) -> dict:
    try:
        with open(_path(user_id), "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"voice": DEFAULT_VOICE_KEY, "history": []}


def _save(user_id: int, data: dict) -> None:
    os.makedirs(USER_DIR, exist_ok=True)
    with open(_path(user_id), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_voice(user_id: int) -> str:
    with _lock:
        return _load(user_id)["voice"]


def set_voice(user_id: int, voice_key: str) -> None:
    with _lock:
        data = _load(user_id)
        data["voice"] = voice_key
        _save(user_id, data)


def add_message(user_id: int, role: str, content: str) -> None:
    with _lock:
        data = _load(user_id)
        data["history"].append({"role": role, "content": content})
        data["history"] = data["history"][-HISTORY_LIMIT:]
        _save(user_id, data)


def get_history(user_id: int) -> list[dict]:
    with _lock:
        return _load(user_id)["history"]


def reset_history(user_id: int) -> None:
    with _lock:
        data = _load(user_id)
        data["history"] = []
        _save(user_id, data)
