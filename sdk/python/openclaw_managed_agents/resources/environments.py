"""Environment resource methods."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx

from ..types import Environment


def _parse_environment(data: Dict[str, Any]) -> Environment:
    return Environment(
        environment_id=data["environment_id"],
        name=data["name"],
        networking=data.get("networking", {"type": "unrestricted"}),
        created_at=data["created_at"],
        description=data.get("description", ""),
        packages=data.get("packages"),
    )


class Environments:
    def __init__(self, client: httpx.Client) -> None:
        self._client = client

    def create(
        self,
        *,
        name: str,
        description: Optional[str] = None,
        packages: Optional[Dict[str, Any]] = None,
        networking: Optional[Dict[str, Any]] = None,
    ) -> Environment:
        body: Dict[str, Any] = {"name": name}
        if description is not None:
            body["description"] = description
        if packages is not None:
            body["packages"] = packages
        if networking is not None:
            body["networking"] = networking
        resp = self._client.post("/v1/environments", json=body)
        resp.raise_for_status()
        return _parse_environment(resp.json())

    def get(self, environment_id: str) -> Environment:
        resp = self._client.get(f"/v1/environments/{environment_id}")
        resp.raise_for_status()
        return _parse_environment(resp.json())

    def list(self) -> List[Environment]:
        resp = self._client.get("/v1/environments")
        resp.raise_for_status()
        return [_parse_environment(e) for e in resp.json()["environments"]]

    def delete(self, environment_id: str) -> None:
        resp = self._client.delete(f"/v1/environments/{environment_id}")
        resp.raise_for_status()
