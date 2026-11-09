from __future__ import annotations
import sqlite3, json, secrets, re
from datetime import datetime, timezone, timedelta
from .config import settings
from .detection import Detector, Finding, safe_fingerprint

TOKEN = re.compile(r"\[\[([A-Z][A-Z0-9_]*)_(\d{3})\]\]")

class Vault:
    def __init__(self):
        self.crypto = settings.fernet()
        self.db = sqlite3.connect(settings.db_path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created TEXT NOT NULL, expires TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS mappings (session_id TEXT, token TEXT, kind TEXT, encrypted BLOB, fingerprint TEXT, PRIMARY KEY(session_id,token));
        CREATE TABLE IF NOT EXISTS audit (created TEXT, event TEXT, session_id TEXT, detail TEXT);
        """)
        self.db.commit()
        self.detector = Detector()

    def session(self, session_id: str | None = None) -> str:
        if session_id and self.db.execute("SELECT 1 FROM sessions WHERE id=?", (session_id,)).fetchone(): return session_id
        sid = "vf_" + secrets.token_urlsafe(18)
        now = datetime.now(timezone.utc)
        self.db.execute("INSERT INTO sessions VALUES (?,?,?)", (sid, now.isoformat(), (now + timedelta(hours=settings.retention_hours)).isoformat()))
        self.db.commit(); return sid

    def _decrypt(self, blob: bytes) -> str | None:
        # A key rotation or a restart with an ephemeral development key leaves
        # old rows undecryptable: drop them instead of failing the request.
        try:
            return self.crypto.decrypt(blob).decode()
        except Exception:
            return None

    def mask(self, text: str, session_id: str | None = None, custom: dict | None = None) -> tuple[str, str, list[dict]]:
        sid = self.session(session_id); findings = self.detector.detect(text, custom)
        rows = self.db.execute("SELECT token,kind,encrypted FROM mappings WHERE session_id=?", (sid,)).fetchall()
        known: dict[tuple[str, str], str] = {}
        counters: dict[str, int] = {}
        for token,kind,blob in rows:
            counters[kind] = max(counters.get(kind, 0), int(token[-5:-2]))
            value = self._decrypt(blob)
            if value is not None: known[(kind, value)] = token
        out, cursor, entities = [], 0, []
        for hit in findings:
            token = known.get((hit.kind, hit.value))
            if not token:
                counters[hit.kind] = counters.get(hit.kind, 0) + 1
                token = f"[[{hit.kind}_{counters[hit.kind]:03d}]]"
                self.db.execute("INSERT INTO mappings VALUES (?,?,?,?,?)", (sid, token, hit.kind, self.crypto.encrypt(hit.value.encode()), safe_fingerprint(hit.value)))
                known[(hit.kind, hit.value)] = token
            out.extend((text[cursor:hit.start], token)); cursor = hit.end
            entities.append({"type": hit.kind, "placeholder": token, "value": hit.value, "start": hit.start, "end": hit.end, "confidence": hit.confidence, "source": hit.source, "fingerprint": safe_fingerprint(hit.value)})
        out.append(text[cursor:]); self.db.execute("INSERT INTO audit VALUES (?,?,?,?)", (datetime.now(timezone.utc).isoformat(), "mask", sid, json.dumps({"count":len(entities),"types":[e['type'] for e in entities]})))
        self.db.commit(); return "".join(out), sid, entities

    def unmask(self, text: str, session_id: str) -> tuple[str, list[str]]:
        rows = self.db.execute("SELECT token,encrypted FROM mappings WHERE session_id=?", (session_id,)).fetchall()
        values = {token:value for token,blob in rows if (value := self._decrypt(blob)) is not None}
        unresolved: list[str] = []
        def replace(m):
            token=m.group(0)
            if token in values: return values[token]
            unresolved.append(token); return token
        result=TOKEN.sub(replace,text)
        self.db.execute("INSERT INTO audit VALUES (?,?,?,?)", (datetime.now(timezone.utc).isoformat(), "unmask", session_id, json.dumps({"unresolved":len(unresolved)}))); self.db.commit()
        return result, unresolved

    def audit(self, event: str, session_id: str | None, detail: dict):
        self.db.execute("INSERT INTO audit VALUES (?,?,?,?)", (datetime.now(timezone.utc).isoformat(), event, session_id, json.dumps(detail))); self.db.commit()

    def analytics(self):
        total=self.db.execute("SELECT count(*) FROM audit WHERE event='mask'").fetchone()[0]
        sessions=self.db.execute("SELECT count(*) FROM sessions").fetchone()[0]
        return {"masked_requests":total,"active_sessions":sessions,"storage":"local encrypted SQLite","retention_hours":settings.retention_hours}

vault = Vault()
