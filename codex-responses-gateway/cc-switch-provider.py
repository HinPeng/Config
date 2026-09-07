"""Read selected Codex providers without modifying the CC Switch database."""

import json
import sqlite3
import sys
import tomllib
from pathlib import Path


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
            provider = config["model_providers"][config["model_provider"]]
            if provider.get("wire_api") != "responses":
                raise ValueError(f"Provider {name} must use wire_api = responses")
            result[name] = {
                "baseUrl": provider["base_url"],
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
