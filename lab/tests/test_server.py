import asyncio
import sys

from mcp import Client, StdioServerParameters

from sports_leader_lab import DISCLAIMER
from sports_leader_lab.server import health, mcp


def test_server_reports_the_package_version():
    assert mcp.version == "0.1.0.dev0"


def test_health_payload_is_a_research_ping():
    payload = health()
    assert payload["ok"] is True
    assert payload["server"] == "sports-leader-lab"
    assert payload["version"] == "0.1.0.dev0"
    assert payload["disclaimer"] == DISCLAIMER
    assert "betting edge" in DISCLAIMER
    assert "not a recommendation to bet" in DISCLAIMER.lower()


def test_ping_tool_is_registered():
    tools = asyncio.run(_tool_names(mcp))
    assert tools == ["ping"]


def test_stdio_module_entrypoint_answers_ping():
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "sports_leader_lab"],
    )

    async def run():
        async with Client(params) as client:
            listed = await client.list_tools()
            names = [tool.name for tool in listed.tools]
            result = await client.call_tool("ping", {})
            return names, _payload(result)

    names, payload = asyncio.run(run())
    assert names == ["ping"]
    assert payload["ok"] is True
    assert payload["server"] == "sports-leader-lab"
    assert "not a recommendation to bet" in payload["disclaimer"].lower()


async def _tool_names(server):
    async with Client(server) as client:
        listed = await client.list_tools()
        return [tool.name for tool in listed.tools]


def _payload(result):
    structured = getattr(result, "structured_content", None)
    if isinstance(structured, dict) and "ok" in structured:
        return structured
    data = getattr(result, "data", None)
    if isinstance(data, dict) and "ok" in data:
        return data
    content = getattr(result, "content", None) or []
    for block in content:
        text = getattr(block, "text", None)
        if isinstance(text, str) and text.startswith("{"):
            import json

            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
    raise AssertionError(f"ping result had no payload: {result!r}")
