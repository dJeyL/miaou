#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["mcp>=1.2", "uvicorn", "starlette"]
# ///
"""
Serveur MCP météo pour MIAOU.

Transport streamable-http (single endpoint POST, réponses en SSE). CORS ouvert
pour permettre au navigateur de l'atteindre directement depuis dist/miaou.html.

Outils exposés :
  - get_weather(city, state?, country?) : météo actuelle via wttr.in (JSON allégé)

Lancement :
    uv run tests/mcp_weather.py            # écoute sur 127.0.0.1:8766
    uv run tests/mcp_weather.py 0.0.0.0 8766   # toutes interfaces, même port

Dans MIAOU → Paramètres → Serveurs MCP → Ajouter :
    Nom       : weather
    URL       : http://127.0.0.1:8766/mcp
    Transport : streamable-http   (deviné depuis /mcp)
    Activé    : oui
"""

import json
import os
import sys
import urllib.request
from typing import Optional

from mcp import types
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.middleware.cors import CORSMiddleware

_security = TransportSecuritySettings(enable_dns_rebinding_protection=False)

mcp = FastMCP("miaou-weather", transport_security=_security)


@mcp.tool()
async def get_weather(
    city: str,
    state: Optional[str] = None,
    country: Optional[str] = None,
) -> types.EmbeddedResource:
    """Renvoie la météo actuelle pour une ville via wttr.in (JSON allégé sans astronomy ni hourly)."""
    parts = [city]
    if state:
        parts.append(state)
    if country:
        parts.append(country)
    location = ",".join(parts)

    url = f"http://wttr.in/{urllib.request.quote(location)}?format=j1"

    proxy_url = os.environ.get("http_proxy") or os.environ.get("HTTP_PROXY")
    if proxy_url:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url})
        )
    else:
        opener = urllib.request.build_opener()

    with opener.open(url, timeout=10) as resp:
        data = json.loads(resp.read().decode())

    for day in data.get("weather", []):
        day.pop("astronomy", None)
        day.pop("hourly", None)

    return types.EmbeddedResource(
        type="resource",
        resource=types.TextResourceContents(
            uri=f"miaou://weather/{location}",
            mimeType="application/json",
            text=json.dumps(data, ensure_ascii=False),
        ),
    )


def main() -> None:
    host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8766

    app = mcp.streamable_http_app()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "OPTIONS", "DELETE"],
        allow_headers=["*"],
        expose_headers=["Mcp-Session-Id"],
    )

    import uvicorn

    print(f"MCP weather → http://{host}:{port}/mcp  (Ctrl-C pour arrêter)")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
