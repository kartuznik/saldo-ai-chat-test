"""FastAPI proxy to OpenRouter. Streams chat completions as SSE."""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MAX_HISTORY = 30

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
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "model": MODEL}


@app.post("/api/chat")
async def chat(body: ChatRequest, request: Request):
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
    try:
        upstream = await client.send(upstream_req, stream=True)
    except asyncio.CancelledError:
        log.info("upstream cancelled: client disconnected")
        raise
    except httpx.TimeoutException:
        log.error("upstream timeout before stream started")
        return JSONResponse(
            {"error": "upstream_timeout", "message": "OpenRouter timed out"},
            status_code=504,
        )
    except httpx.RequestError as exc:
        log.error("upstream request failed: %s", type(exc).__name__)
        return JSONResponse(
            {"error": "upstream_error", "message": "OpenRouter request failed"},
            status_code=502,
        )

    if upstream.status_code != 200:
        status = upstream.status_code
        retry_after = upstream.headers.get("Retry-After")
        await upstream.aclose()
        log.error("upstream status=%s", status)
        if status == 429:
            response_headers = {}
            if retry_after:
                response_headers["Retry-After"] = retry_after
            return JSONResponse(
                {"error": "rate_limit", "message": "OpenRouter rate limit"},
                status_code=429,
                headers=response_headers,
            )
        return JSONResponse(
            {"error": "upstream_error", "message": "OpenRouter request failed"},
            status_code=502,
        )

    async def generate():
        try:
            async for line in upstream.aiter_lines():
                if await request.is_disconnected():
                    log.info("upstream cancelled: client disconnected")
                    break
                if not line or line.startswith(":"):
                    continue
                if line.startswith("data: "):
                    yield f"{line}\n\n"
                    if line[6:].strip() == "[DONE]":
                        break
        except asyncio.CancelledError:
            log.info("upstream cancelled: client disconnected")
            raise
        except httpx.TimeoutException:
            log.error("upstream timeout during stream")
        except httpx.HTTPError as exc:
            log.error("upstream stream error: %s", type(exc).__name__)
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
