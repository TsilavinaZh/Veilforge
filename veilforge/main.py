from __future__ import annotations
import json, time
from pathlib import Path
from typing import Any
import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from .config import settings
from .vault import vault

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

app = FastAPI(
    title="Veilforge Privacy Gateway",
    version="1.0.0",
    description="Local-first reversible privacy firewall for LLM traffic.",
    docs_url="/swagger",
    redoc_url="/redoc",
)
app.mount("/assets", StaticFiles(directory=str(WEB_DIR)), name="assets")
_hits: dict[str, list[float]] = {}

def guard(request: Request, authorization: str | None):
    # Browser console may use local development key. All API clients must send Bearer key.
    supplied=(authorization or "").removeprefix("Bearer ")
    if supplied != settings.api_key: raise HTTPException(401, "invalid API key")
    ip=request.client.host if request.client else "unknown"; now=time.time(); events=_hits.setdefault(ip,[]); events[:]=[x for x in events if now-x<60]
    if len(events)>=120: raise HTTPException(429, "rate limit exceeded")
    events.append(now)

class TextInput(BaseModel):
    text: str = Field(max_length=500_000)
    session_id: str | None = None
    custom_dictionary: dict[str,list[str]] | None = None

@app.get("/", include_in_schema=False)
def home(): return FileResponse(WEB_DIR / "index.html")

@app.get("/docs", include_in_schema=False)
def docs(): return FileResponse(WEB_DIR / "docs.html")

@app.get("/api/v1/health")
def health(): return {"status":"ok","mode":"fail-closed" if settings.fail_closed else "permissive","upstream_configured":bool(settings.upstream_url)}

@app.post("/api/v1/detect")
async def detect(body: TextInput, request: Request, authorization: str | None = Header(None)):
    guard(request,authorization); return {"entities":[f.__dict__ | {"value_hash": __import__('veilforge.detection',fromlist=['safe_fingerprint']).safe_fingerprint(f.value)} for f in vault.detector.detect(body.text,body.custom_dictionary)]}

@app.post("/api/v1/mask")
async def mask(body: TextInput, request: Request, authorization: str | None = Header(None)):
    guard(request,authorization); text,sid,entities=vault.mask(body.text,body.session_id,body.custom_dictionary); return {"masked_text":text,"session_id":sid,"entities":entities}

@app.post("/api/v1/unmask")
async def unmask(body: TextInput, request: Request, authorization: str | None = Header(None)):
    guard(request,authorization)
    if not body.session_id: raise HTTPException(422,"session_id is required")
    text,unresolved=vault.unmask(body.text,body.session_id); return {"text":text,"unresolved":unresolved}

@app.post("/api/v1/analyze")
async def analyze(body: TextInput, request: Request, authorization: str | None = Header(None)):
    guard(request,authorization); masked,sid,entities=vault.mask(body.text,body.session_id,body.custom_dictionary); return {"session_id":sid,"masked_preview":masked,"risk":"high" if entities else "none","entities":entities}

@app.post("/api/v1/sessions")
async def create_session(request: Request, authorization: str | None = Header(None)):
    guard(request,authorization); return {"session_id":vault.session()}

@app.get("/api/v1/sessions")
async def sessions(request: Request, authorization: str | None = Header(None)):
    guard(request,authorization); return {"sessions":[{"id":r[0],"created":r[1],"expires":r[2]} for r in vault.db.execute("SELECT * FROM sessions ORDER BY created DESC LIMIT 100")]}

@app.get("/api/v1/analytics")
async def analytics(request: Request, authorization: str | None = Header(None)):
    guard(request,authorization); return vault.analytics()

def protect(value: Any, sid: str) -> tuple[Any,str]:
    if isinstance(value,str): return vault.mask(value,sid)[0],sid
    if isinstance(value,list):
        for i,x in enumerate(value): value[i],sid=protect(x,sid)
    elif isinstance(value,dict):
        for key,x in list(value.items()):
            if key not in {"model","role","stream","temperature","max_tokens"}: value[key],sid=protect(x,sid)
    return value,sid
def restore(value: Any,sid: str) -> Any:
    if isinstance(value,str): return vault.unmask(value,sid)[0]
    if isinstance(value,list): return [restore(x,sid) for x in value]
    if isinstance(value,dict): return {k:restore(v,sid) for k,v in value.items()}
    return value

@app.post("/v1/chat/completions")
async def chat(payload: dict, request: Request, authorization: str | None = Header(None), x_veilforge_session: str | None = Header(None)):
    guard(request,authorization); sid=vault.session(x_veilforge_session); protected,sid=protect(payload,sid)
    if not settings.upstream_url:
        content="Development echo (no upstream configured): " + json.dumps(protected.get("messages",[]),ensure_ascii=False)
        return {"id":"mock-veilforge","object":"chat.completion","model":payload.get("model","mock"),"choices":[{"index":0,"message":{"role":"assistant","content":restore(content,sid)},"finish_reason":"stop"}],"veilforge":{"session_id":sid,"mock":True}}
    headers={"Authorization":f"Bearer {settings.upstream_api_key}","Content-Type":"application/json"}
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response=await client.post(settings.upstream_url.rstrip("/")+"/chat/completions",json=protected,headers=headers)
            response.raise_for_status()
            if payload.get("stream"):
                async def stream():
                    async for line in response.aiter_lines():
                        yield (vault.unmask(line,sid)[0]+"\n\n").encode()
                return StreamingResponse(stream(),media_type="text/event-stream",headers={"X-Veilforge-Session":sid})
            return JSONResponse(restore(response.json(),sid),headers={"X-Veilforge-Session":sid})
    except httpx.HTTPError as e:
        vault.audit("upstream_error",sid,{"kind":type(e).__name__})
        raise HTTPException(502,"upstream unavailable; request was not returned unprotected")
