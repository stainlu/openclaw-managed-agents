"""Vault resource methods."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx

from ..types import Vault, VaultCredential


def _parse_vault(data: Dict[str, Any]) -> Vault:
    return Vault(
        vault_id=data["vault_id"],
        user_id=data["user_id"],
        name=data["name"],
        created_at=data["created_at"],
        updated_at=data["updated_at"],
    )


def _parse_credential(data: Dict[str, Any]) -> VaultCredential:
    return VaultCredential(
        credential_id=data["credential_id"],
        vault_id=data["vault_id"],
        name=data["name"],
        type=data["type"],
        match_url=data["match_url"],
        created_at=data["created_at"],
        updated_at=data["updated_at"],
        token_endpoint=data.get("token_endpoint"),
        client_id=data.get("client_id"),
        scopes=data.get("scopes"),
        expires_at=data.get("expires_at"),
    )


class Vaults:
    def __init__(self, client: httpx.Client) -> None:
        self._client = client

    def create(self, *, user_id: str, name: str = "") -> Vault:
        resp = self._client.post("/v1/vaults", json={"userId": user_id, "name": name})
        resp.raise_for_status()
        return _parse_vault(resp.json())

    def get(self, vault_id: str) -> Vault:
        resp = self._client.get(f"/v1/vaults/{vault_id}")
        resp.raise_for_status()
        return _parse_vault(resp.json())

    def list(self, *, user_id: Optional[str] = None) -> List[Vault]:
        params: Dict[str, Any] = {}
        if user_id is not None:
            params["user_id"] = user_id
        resp = self._client.get("/v1/vaults", params=params)
        resp.raise_for_status()
        return [_parse_vault(v) for v in resp.json()["vaults"]]

    def delete(self, vault_id: str) -> None:
        resp = self._client.delete(f"/v1/vaults/{vault_id}")
        resp.raise_for_status()

    def add_static_bearer_credential(
        self,
        vault_id: str,
        *,
        name: str,
        match_url: str,
        token: str,
    ) -> VaultCredential:
        body = {
            "name": name,
            "type": "static_bearer",
            "matchUrl": match_url,
            "token": token,
        }
        resp = self._client.post(f"/v1/vaults/{vault_id}/credentials", json=body)
        resp.raise_for_status()
        return _parse_credential(resp.json())

    def add_mcp_oauth_credential(
        self,
        vault_id: str,
        *,
        name: str,
        match_url: str,
        access_token: str,
        refresh_token: str,
        expires_at: int,
        token_endpoint: str,
        client_id: str,
        client_secret: str,
        scopes: Optional[List[str]] = None,
    ) -> VaultCredential:
        body: Dict[str, Any] = {
            "name": name,
            "type": "mcp_oauth",
            "matchUrl": match_url,
            "accessToken": access_token,
            "refreshToken": refresh_token,
            "expiresAt": expires_at,
            "tokenEndpoint": token_endpoint,
            "clientId": client_id,
            "clientSecret": client_secret,
        }
        if scopes is not None:
            body["scopes"] = scopes
        resp = self._client.post(f"/v1/vaults/{vault_id}/credentials", json=body)
        resp.raise_for_status()
        return _parse_credential(resp.json())

    def list_credentials(self, vault_id: str) -> List[VaultCredential]:
        resp = self._client.get(f"/v1/vaults/{vault_id}/credentials")
        resp.raise_for_status()
        return [_parse_credential(c) for c in resp.json()["credentials"]]

    def delete_credential(self, vault_id: str, credential_id: str) -> None:
        resp = self._client.delete(f"/v1/vaults/{vault_id}/credentials/{credential_id}")
        resp.raise_for_status()
