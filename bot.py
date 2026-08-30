"""Spanish voice tutor Telegram bot (aiogram 3, polling)."""

import asyncio
import io
import logging
import os
import subprocess
import tempfile

from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.types import (
    BufferedInputFile,
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)
from dotenv import load_dotenv

load_dotenv()  # must run before stt/tutor import (they read env vars at import time)

import storage
import stt
import tutor
from tts import VOICES, get_voice_id, synthesize

logging.basicConfig(level=logging.INFO)

bot = Bot(token=os.environ["TELEGRAM_BOT_TOKEN"])
dp = Dispatcher()


def mp3_to_ogg(mp3_bytes: bytes) -> bytes:
    """Convert MP3 to OGG/OPUS so Telegram shows it as a voice note."""
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as fin:
        fin.write(mp3_bytes)
        in_path = fin.name
    out_path = in_path.replace(".mp3", ".ogg")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", in_path, "-c:a", "libopus", "-b:a", "48k", out_path],
            check=True,
            capture_output=True,
        )
        with open(out_path, "rb") as f:
            return f.read()
    finally:
        for p in (in_path, out_path):
            try:
                os.unlink(p)
            except OSError:
                pass


async def send_tutor_reply(message: Message, user_text: str) -> None:
    """Full tutor turn: store user text, get reply, send it back as a voice note."""
    user_id = message.from_user.id
    storage.add_message(user_id, "user", user_text)
    try:
        answer = await asyncio.to_thread(tutor.reply, storage.get_history(user_id))
    except Exception:
        logging.exception("tutor call failed")
        await message.reply("Perdón, hubo un error. Intenta de nuevo. 🙏")
        return
    storage.add_message(user_id, "assistant", answer)

    try:
        voice_id = get_voice_id(storage.get_voice(user_id))
        mp3 = await synthesize(answer, voice_id)
        ogg = mp3_to_ogg(mp3)
        await message.reply_voice(BufferedInputFile(ogg, filename="reply.ogg"))
    except Exception:
        logging.exception("tts failed, sending text fallback")
        await message.reply(answer)


@dp.message(Command("start"))
async def cmd_start(message: Message) -> None:
    await message.reply(
        "¡Hola! 👋 Soy tu tutor de español.\n\n"
        "Mándame un mensaje de voz en español y te respondo con voz. "
        "Si cometes errores, te corrijo.\n\n"
        "/voice — elegir acento y voz\n"
        "/reset — empezar una conversación nueva"
    )


@dp.message(Command("reset"))
async def cmd_reset(message: Message) -> None:
    storage.reset_history(message.from_user.id)
    await message.reply("¡Conversación nueva! Empecemos de nuevo. ¿Cómo estás?")


@dp.message(Command("voice"))
async def cmd_voice(message: Message) -> None:
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=label, callback_data=f"voice:{key}")]
            for key, (label, _) in VOICES.items()
        ]
    )
    current = VOICES[storage.get_voice(message.from_user.id)][0]
    await message.reply(f"Voz actual: {current}\nElige una voz:", reply_markup=keyboard)


@dp.callback_query(F.data.startswith("voice:"))
async def on_voice_chosen(callback: CallbackQuery) -> None:
    key = callback.data.split(":", 1)[1]
    if key not in VOICES:
        await callback.answer("Voz no válida")
        return
    storage.set_voice(callback.from_user.id, key)
    await callback.message.edit_text(f"Voz cambiada a: {VOICES[key][0]} ✅")
    await callback.answer()


@dp.message(F.voice)
async def on_voice_message(message: Message) -> None:
    await message.answer("🎧 Escuchando…")
    with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as f:
        await bot.download(message.voice, destination=f.name)
        ogg_path = f.name
    try:
        user_text = await asyncio.to_thread(stt.transcribe, ogg_path)
    except Exception:
        logging.exception("stt failed")
        await message.reply("No pude entender el audio. Intenta de nuevo. 🙏")
        return
    finally:
        try:
            os.unlink(ogg_path)
        except OSError:
            pass

    if not user_text:
        await message.reply("No escuché nada. Intenta de nuevo. 🙏")
        return
    await send_tutor_reply(message, user_text)


@dp.message(F.text & ~F.text.startswith("/"))
async def on_text_message(message: Message) -> None:
    """Typed Spanish practice gets the same tutor flow."""
    await send_tutor_reply(message, message.text)


async def main() -> None:
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
