import type { HttpClient } from "../http.js";
import type { Vault, VaultCredential } from "../types.js";

export interface CreateVaultParams {
  userId: string;
  name?: string;
}

export interface AddStaticBearerCredentialParams {
  name: string;
  type: "static_bearer";
  matchUrl: string;
  token: string;
}

export interface AddMcpOAuthCredentialParams {
  name: string;
  type: "mcp_oauth";
  matchUrl: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
}

export type AddCredentialParams =
  | AddStaticBearerCredentialParams
  | AddMcpOAuthCredentialParams;

export class Vaults {
  constructor(private readonly http: HttpClient) {}

  create(params: CreateVaultParams): Promise<Vault> {
    const body: Record<string, unknown> = { userId: params.userId };
    if (params.name !== undefined) body["name"] = params.name;
    return this.http.request<Vault>("POST", "/v1/vaults", body);
  }

  get(vaultId: string): Promise<Vault> {
    return this.http.request<Vault>("GET", `/v1/vaults/${encodeURIComponent(vaultId)}`);
  }

  async list(params: { userId?: string } = {}): Promise<Vault[]> {
    const qs = params.userId === undefined ? "" : `?user_id=${encodeURIComponent(params.userId)}`;
    const resp = await this.http.request<{ vaults: Vault[] }>("GET", `/v1/vaults${qs}`);
    return resp.vaults;
  }

  async delete(vaultId: string): Promise<void> {
    await this.http.request<void>("DELETE", `/v1/vaults/${encodeURIComponent(vaultId)}`);
  }

  addCredential(vaultId: string, params: AddCredentialParams): Promise<VaultCredential> {
    return this.http.request<VaultCredential>(
      "POST",
      `/v1/vaults/${encodeURIComponent(vaultId)}/credentials`,
      params,
    );
  }

  async listCredentials(vaultId: string): Promise<VaultCredential[]> {
    const resp = await this.http.request<{ credentials: VaultCredential[] }>(
      "GET",
      `/v1/vaults/${encodeURIComponent(vaultId)}/credentials`,
    );
    return resp.credentials;
  }

  async deleteCredential(vaultId: string, credentialId: string): Promise<void> {
    await this.http.request<void>(
      "DELETE",
      `/v1/vaults/${encodeURIComponent(vaultId)}/credentials/${encodeURIComponent(credentialId)}`,
    );
  }
}
