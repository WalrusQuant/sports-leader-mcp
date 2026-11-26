"""stdio MCP server. Phase 1 exposes a ping tool; modeling tools come later."""

from __future__ import annotations

from typing import Any

from mcp.server import MCPServer

from sports_leader_lab import DISCLAIMER, __version__

INSTRUCTIONS = (
    "Sports modeling research lab over the public sportsleader-data Parquet files. "
    "Phase 1 answers a health check only. Features and splits are leakage-safe "
    "when later tools use them. " + DISCLAIMER
)

mcp = MCPServer("sports-leader-lab", instructions=INSTRUCTIONS, version=__version__)


def health() -> dict[str, Any]:
    return {
        "ok": True,
        "server": "sports-leader-lab",
        "version": __version__,
        "disclaimer": DISCLAIMER,
    }


@mcp.tool()
def ping() -> dict[str, Any]:
    """Health check for the sports-leader-lab research server.

    The lab measures fit against simple baselines. It does not provide a
    betting edge, a pick, or a recommendation to bet.
    """
    return health()


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
