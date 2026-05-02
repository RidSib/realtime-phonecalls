import "dotenv/config";

export type RealtimeProvider = "openai" | "azure";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v === "" ? undefined : v;
}

export interface AppConfig {
  port: number;
  /** Base URL Twilio reaches (https://…), no trailing slash */
  publicUrl: string;
  realtimeProvider: RealtimeProvider;
  openaiApiKey?: string;
  openaiRealtimeModel: string;
  azureEndpoint?: string;
  azureApiKey?: string;
  azureDeployment?: string;
  twilioAuthToken: string;
  twilioValidateSignature: boolean;
  instructions: string;
  voice: string;
}

export function loadConfig(): AppConfig {
  const port = Number(process.env.PORT ?? "5050");
  const publicUrl = env("PUBLIC_URL");
  const provider = (process.env.REALTIME_PROVIDER ??
    "openai") as RealtimeProvider;
  if (provider !== "openai" && provider !== "azure") {
    throw new Error("REALTIME_PROVIDER must be openai or azure");
  }

  const twilioAuthToken = env("TWILIO_AUTH_TOKEN");
  const validateSig =
    (process.env.TWILIO_VALIDATE_SIGNATURE ?? "true").toLowerCase() !==
    "false";

  let openaiApiKey: string | undefined;
  let azureEndpoint: string | undefined;
  let azureApiKey: string | undefined;
  let azureDeployment: string | undefined;

  if (provider === "openai") {
    openaiApiKey = env("OPENAI_API_KEY");
  } else {
    azureEndpoint = env("AZURE_OPENAI_ENDPOINT");
    azureApiKey = env("AZURE_OPENAI_API_KEY");
    azureDeployment = env("AZURE_OPENAI_DEPLOYMENT_NAME");
  }

  return {
    port: Number.isFinite(port) ? port : 5050,
    publicUrl,
    realtimeProvider: provider,
    openaiApiKey,
    openaiRealtimeModel:
      process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime",
    azureEndpoint,
    azureApiKey,
    azureDeployment,
    twilioAuthToken,
    twilioValidateSignature: validateSig,
    instructions:
      optional("ASSISTANT_INSTRUCTIONS") ??
      "You are a helpful voice assistant on a phone call. " +
        "Keep replies concise and conversational.",
    voice: process.env.REALTIME_VOICE ?? "alloy",
  };
}

/** Full webhook URL used for Twilio signature validation */
export function voiceWebhookUrl(cfg: AppConfig): string {
  const base = cfg.publicUrl.replace(/\/$/, "");
  return `${base}/voice`;
}
