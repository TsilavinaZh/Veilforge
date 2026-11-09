from dataclasses import dataclass
import os
from cryptography.fernet import Fernet

@dataclass(frozen=True)
class Settings:
    api_key: str = os.getenv("VEILFORGE_API_KEY", "local-dev-key")
    db_path: str = os.getenv("VEILFORGE_DB_PATH", "veilforge.db")
    upstream_url: str = os.getenv("VEILFORGE_UPSTREAM_URL", "")
    upstream_api_key: str = os.getenv("VEILFORGE_UPSTREAM_API_KEY", "")
    fail_closed: bool = os.getenv("VEILFORGE_FAIL_CLOSED", "true").lower() == "true"
    retention_hours: int = int(os.getenv("VEILFORGE_RETENTION_HOURS", "24"))
    encryption_key: str = os.getenv("VEILFORGE_ENCRYPTION_KEY", "")

    def fernet(self) -> Fernet:
        # Development key is ephemeral across restarts: deliberately unsuitable for production.
        return Fernet(self.encryption_key.encode() if self.encryption_key else Fernet.generate_key())

settings = Settings()
