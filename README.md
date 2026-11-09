# Veilforge

**Veilforge** is a local-first privacy firewall for LLM traffic. It detects sensitive values, replaces them with session-scoped reversible tokens before forwarding requests, then restores them in returned completions.

This is an independent implementation inspired by the privacy-gateway problem space; it does not contain code, models, or assets from PII Guard.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn veilforge.main:app --reload --port 8787
```

Open `http://localhost:8787`. The root URL is a presentation page (hero, provider logos, architecture, capabilities, integration snippet) that ends with a live example: **Lancer la démonstration** masks a fictional text, shows the tokens and restores the original values in the same session. There is no console UI — only this page and the API docs at `/docs`.

## Use as an OpenAI-compatible gateway

Set `VEILFORGE_UPSTREAM_URL` and `VEILFORGE_UPSTREAM_API_KEY`, then point an OpenAI client at `http://localhost:8787/v1`.

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:8787/v1", api_key="local-dev-key")
client.chat.completions.create(model="gpt-4o-mini", messages=[
    {"role": "user", "content": "Email Ana at ana@example.com"}
])
```

Without an upstream, the gateway returns a safe local echo for development only (`mock: true`); it is never represented as an LLM response.

## Security model

Mappings are encrypted at rest using Fernet and isolated by random session IDs. Logs retain only categories, counts, and hashes—never raw detected values. Set `VEILFORGE_ENCRYPTION_KEY` and `VEILFORGE_API_KEY` to strong secrets before production. `FAIL_CLOSED=true` rejects unsupported content shapes and upstream failures rather than risking disclosure.

Rule-based detection is designed as a reliable baseline, not a compliance guarantee. Add a local spaCy/Presidio implementation through `Detector` for higher-recall NER. Image/OCR requires an explicitly configured local OCR service and is therefore deliberately rejected by fail-closed mode when unavailable.

## Features implemented

- Session-consistent reversible placeholders and safe malformed-token handling
- Detection for emails, phones, cards (Luhn-checked), IPs, credentials, URLs, bank-like IBANs, IDs, dates, custom dictionary values, and conservative names
- Multilingual cues for English, French, Malagasy, German and Spanish
- OpenAI Chat Completions compatibility, including SSE passthrough/unmasking
- Provider configuration (OpenAI-compatible, Anthropic-compatible via configured proxy, Ollama/custom endpoints)
- Auth, rate limiting, encrypted SQLite storage, retention cleanup, audit events, analytics
- Landing page with illustrations, provider logos, loading state, health status, and a live mask/unmask example
- Health/readiness endpoints, Docker Compose, tests

## API

`POST /api/v1/detect`, `/mask`, `/unmask`, `/analyze`, `/sessions`, `GET /api/v1/sessions`, `/analytics`, `/health` and `POST /v1/chat/completions` are documented in Swagger.

## Architecture

`client → Veilforge detector/mapping vault → provider` and `provider response → mapping vault → client`.
Only tokenized content crosses the upstream boundary. The gateway recursively protects message content, tool schemas/arguments and tool results when they are string fields.

## License

Apache-2.0. See [LICENSE](LICENSE).
