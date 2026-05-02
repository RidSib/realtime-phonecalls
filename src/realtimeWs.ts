import type { AppConfig } from "./config.js";

export interface RealtimeConnectOptions {
  url: string;
  headers: Record<string, string>;
}

/** Build OpenAI or Azure Realtime WebSocket URL and handshake headers. */
export function realtimeConnectOptions(cfg: AppConfig): RealtimeConnectOptions {
  if (cfg.realtimeProvider === "openai") {
    const key = cfg.openaiApiKey!;
    const m = encodeURIComponent(cfg.openaiRealtimeModel);
    return {
      url: `wss://api.openai.com/v1/realtime?model=${m}`,
      headers: {
        Authorization: `Bearer ${key}`,
      },
    };
  }

  const raw = cfg.azureEndpoint!.replace(/^https?:\/\//i, "").replace(
    /\/$/,
    "",
  );
  const dep = encodeURIComponent(cfg.azureDeployment!);
  const url = `wss://${raw}/openai/v1/realtime?model=${dep}`;
  return {
    url,
    headers: {
      "api-key": cfg.azureApiKey!,
    },
  };
}
