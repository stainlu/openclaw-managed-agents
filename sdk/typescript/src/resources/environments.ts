import type { HttpClient } from "../http.js";
import type { Environment, EnvironmentNetworking, EnvironmentPackages } from "../types.js";

export interface CreateEnvironmentParams {
  name: string;
  packages?: EnvironmentPackages;
  networking?: EnvironmentNetworking;
}

export class Environments {
  constructor(private readonly http: HttpClient) {}

  create(params: CreateEnvironmentParams): Promise<Environment> {
    const body: Record<string, unknown> = { name: params.name };
    if (params.packages !== undefined) body["packages"] = params.packages;
    if (params.networking !== undefined) body["networking"] = params.networking;
    return this.http.request<Environment>("POST", "/v1/environments", body);
  }

  get(environmentId: string): Promise<Environment> {
    return this.http.request<Environment>(
      "GET",
      `/v1/environments/${encodeURIComponent(environmentId)}`,
    );
  }

  async list(): Promise<Environment[]> {
    const resp = await this.http.request<{ environments: Environment[] }>(
      "GET",
      "/v1/environments",
    );
    return resp.environments;
  }

  async delete(environmentId: string): Promise<void> {
    await this.http.request<void>(
      "DELETE",
      `/v1/environments/${encodeURIComponent(environmentId)}`,
    );
  }
}
