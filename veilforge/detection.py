from __future__ import annotations
import re
from dataclasses import dataclass
from hashlib import sha256

@dataclass(frozen=True)
class Finding:
    kind: str
    value: str
    start: int
    end: int
    confidence: float
    source: str = "rules"

PATTERNS = {
    "EMAIL": (r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", .99),
    "IP_ADDRESS": (r"\b(?:\d{1,3}\.){3}\d{1,3}\b", .94),
    "PHONE": (r"(?<!\w)(?:\+?\d{1,3}[ .-]?)?(?:\(?\d{2,4}\)?[ .-]?){2,4}\d{2,4}(?!\w)", .83),
    "IBAN": (r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b", .96),
    "SECRET": (r"\b(?:sk|pk|ghp|xoxb|AKIA)[_-]?[A-Za-z0-9_-]{16,}\b|(?i:(?:password|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+)", .99),
    "DATE_OF_BIRTH": (r"(?i)\b(?:born|né(?:e)?|nacido|geboren|teraka)\s*(?:on|le|el|am|ny)?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b", .88),
    "NATIONAL_ID": (r"(?i)\b(?:passport|passeport|dni|nie|ausweis|cin|national id)\s*(?:no\.?|n°|:)?\s*[A-Z0-9-]{5,18}\b", .91),
}
CARD = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")
NAME = re.compile(r"\b[A-ZÀ-Ý][a-zà-ÿ]{1,24}\s+[A-ZÀ-Ý][a-zà-ÿ]{1,24}\b")

def _luhn(value: str) -> bool:
    digits = [int(c) for c in value if c.isdigit()]
    if not 13 <= len(digits) <= 19: return False
    # Starting at the rightmost check digit, double every second preceding digit.
    return sum(d if i % 2 == 0 else (d * 2 - 9 if d > 4 else d * 2) for i, d in enumerate(reversed(digits))) % 10 == 0

class Detector:
    def detect(self, text: str, custom: dict[str, list[str]] | None = None) -> list[Finding]:
        found: list[Finding] = []
        for kind, (pattern, score) in PATTERNS.items():
            for m in re.finditer(pattern, text): found.append(Finding(kind, m.group(), m.start(), m.end(), score))
        for m in CARD.finditer(text):
            if _luhn(m.group()): found.append(Finding("CREDIT_CARD", m.group(), m.start(), m.end(), .99))
        # Names require a nearby human cue to avoid masking ordinary title case prose.
        for m in NAME.finditer(text):
            left = text[max(0, m.start()-24):m.start()].lower()
            if any(c in left for c in ("name", "nom", "nombre", "kunde", "client", "mr", "mrs", "m. ")):
                found.append(Finding("PERSON", m.group(), m.start(), m.end(), .69, "context"))
        for kind, values in (custom or {}).items():
            for value in values:
                for m in re.finditer(re.escape(value), text, re.I): found.append(Finding(kind.upper(), m.group(), m.start(), m.end(), 1.0, "dictionary"))
        # Keep non-overlapping highest-confidence spans.
        chosen: list[Finding] = []
        for item in sorted(found, key=lambda x: (-x.confidence, x.start, -(x.end-x.start))):
            if not any(item.start < x.end and item.end > x.start for x in chosen): chosen.append(item)
        return sorted(chosen, key=lambda x: x.start)

def safe_fingerprint(value: str) -> str:
    return sha256(value.encode()).hexdigest()[:16]
