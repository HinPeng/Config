"""Read selected Codex providers without modifying the CC Switch database."""

import configparser
import json
import sqlite3
import sys
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
            # Keep the parser compatible with the system Python (< 3.11),
            # while accepting the quoted keys used by TOML as well.
            config = configparser.ConfigParser(interpolation=None)
            config.optionxform = str
            config.read_string("[__top__]\n" + settings["config"])
            model_provider = config.get("__top__", "model_provider", fallback=None)
            if not model_provider:
                raise ValueError("Missing model_provider")
            provider_key = next(
                (section for section in config.sections()
                 if section.strip().strip('"') == f"model_providers.{model_provider.strip().strip(chr(34))}"),
                None,
            )
            if not provider_key:
                raise ValueError(f"Missing model_providers.{model_provider}")
            provider = config[provider_key]
            if provider.get("wire_api", "").strip().strip('"') != "responses":
                raise ValueError(f"Provider {name} must use wire_api = responses")
            result[name] = {
                "baseUrl": provider.get("base_url", "").strip().strip('"'),
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
