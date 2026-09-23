"""FastAPI proxy to OpenRouter. Streams chat completions as SSE."""

from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MAX_HISTORY = 30
ALLOWED_ORIGIN = "http://localhost:5173"

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("proxy")


def load_settings() -> tuple[str, str]:
    env_path = Path(__file__).resolve().parent / ".env"
    load_dotenv(env_path)
    api_key = (os.getenv("OPENROUTER_API_KEY") or "").strip()
    model = (os.getenv("MODEL") or "").strip()
    if not api_key or not model:
        print(
            "Missing OPENROUTER_API_KEY or MODEL. "
            "Copy server/.env.example to server/.env and fill in both values.",
            file=sys.stderr,
        )
        raise SystemExit(1)
    return api_key, model


API_KEY, MODEL = load_settings()


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


@asynccontextmanager
async def lifespan(app: FastAPI):
    timeout = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        app.state.http = client
        yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/chat")
async def chat(body: ChatRequest) -> StreamingResponse | JSONResponse:
    client: httpx.AsyncClient = app.state.http
    payload = {
        "model": MODEL,
        "messages": [message.model_dump() for message in body.messages[-MAX_HISTORY:]],
        "stream": True,
    }
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    upstream_req = client.build_request(
        "POST", OPENROUTER_URL, json=payload, headers=headers
    )
    upstream = await client.send(upstream_req, stream=True)

    if upstream.status_code != 200:
        await upstream.aclose()
        return JSONResponse(
            {"error": "upstream_error", "message": "OpenRouter request failed"},
            status_code=502,
        )

    async def generate():
        try:
            async for line in upstream.aiter_lines():
                if not line or line.startswith(":"):
                    continue
                if line.startswith("data: "):
                    yield f"{line}\n\n"
                    if line[6:].strip() == "[DONE]":
                        break
        finally:
            await upstream.aclose()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
