"""Read selected Codex providers without modifying the CC Switch database."""

import json
import sqlite3
import sys
from pathlib import Path

try:
    import tomllib
except ImportError:
    try:
        import tomli as tomllib
    except ImportError:
        sys.exit("CC_SWITCH_ERROR: TOML parser unavailable; set PYTHON_BIN to Python 3.11+ or install tomli for Python 3.9+")


def main():
    database = Path(sys.argv[1]).expanduser().resolve()
    result = {}
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
        for name in sys.argv[2:]:
            rows = connection.execute(
                "SELECT settings_config FROM providers WHERE app_type = ? AND name = ?",
                ("codex", name),
            ).fetchall()
            if len(rows) != 1:
                raise ValueError(f"Expected exactly one Codex provider named {name}")
            settings = json.loads(rows[0][0])
            config = tomllib.loads(settings["config"])
            model_provider = config.get("model_provider")
            if not model_provider:
                raise ValueError("Missing model_provider")
            provider = config.get("model_providers", {}).get(model_provider)
            if not provider:
                raise ValueError(f"Missing model_providers.{model_provider}")
            if provider.get("wire_api") != "responses":
                raise ValueError(f"Provider {name} must use wire_api = responses")
            result[name] = {
                "baseUrl": provider.get("base_url", ""),
                "apiKey": settings["auth"]["OPENAI_API_KEY"],
            }
    # Consumed through a pipe by gateway.mjs; never written to logs or disk.
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Parser exceptions may contain configuration fragments with secrets.
        sys.exit("Cannot load CC Switch providers; check database, unique Codex names, config and auth")
