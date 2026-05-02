import WebSocket from "ws";
import type { RawData } from "ws";
import type { AppConfig } from "./config.js";
import {
  base64ToPcm16,
  pcm16ToBase64,
  pcm24kToTwilioMulawBase64,
  REALTIME_HZ,
  twilioMulawBase64ToPcm24k,
} from "./audio.js";
import { realtimeConnectOptions } from "./realtimeWs.js";

type TwilioEvt = {
  event?: string;
  streamSid?: string;
  start?: { streamSid?: string };
  media?: { track?: string; payload?: string };
};

/** One Twilio Media Stream ↔ OpenAI Realtime session */
export class CallBridge {
  private twilioWs: WebSocket;
  private cfg: AppConfig;
  private streamSid: string | null = null;
  private rt: WebSocket | null = null;
  private sessionReady = false;
  private assistantItemId: string | null = null;
  private assistantAudioMs = 0;
  private activeResponseId: string | null = null;
  /** Fallback when created-event shape differs (e.g. Azure); updated on deltas */
  private lastResponseId: string | null = null;
  private destroyed = false;

  constructor(twilioWs: WebSocket, cfg: AppConfig) {
    this.twilioWs = twilioWs;
    this.cfg = cfg;
    twilioWs.on("message", (d) => this.onTwilioMessage(d));
    twilioWs.on("close", () => this.destroy());
    twilioWs.on("error", () => this.destroy());
  }

  private onTwilioMessage(data: RawData): void {
    let msg: TwilioEvt;
    try {
      msg = JSON.parse(data.toString()) as TwilioEvt;
    } catch {
      return;
    }
    const ev = msg.event;
    if (ev === "start" && msg.start?.streamSid) {
      this.streamSid = msg.start.streamSid;
      this.connectRealtime();
      return;
    }
    if (!this.streamSid || !this.rt || !this.sessionReady) return;
    if (ev !== "media" || !msg.media?.payload) return;
    const track = msg.media.track ?? "inbound";
    if (track !== "inbound") return;

    const pcm24 = twilioMulawBase64ToPcm24k(msg.media.payload);
    const audio = pcm16ToBase64(pcm24);
    this.rt.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio,
      }),
    );
  }

  private connectRealtime(): void {
    if (this.rt || this.destroyed) return;
    const opts = realtimeConnectOptions(this.cfg);
    this.rt = new WebSocket(opts.url, { headers: opts.headers });

    this.rt.on("open", () => {
      const session: Record<string, unknown> = {
        type: "realtime",
        output_modalities: ["audio"],
        instructions: this.cfg.instructions,
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
          },
          output: {
            format: {
              type: "audio/pcm",
              rate: REALTIME_HZ,
            },
            voice: this.cfg.voice,
          },
        },
      };
      if (this.cfg.realtimeProvider === "openai") {
        session.model = this.cfg.openaiRealtimeModel;
      }
      const sessionUpdate = { type: "session.update", session };
      this.rt!.send(JSON.stringify(sessionUpdate));
    });

    this.rt.on("message", (d) => this.onRealtimeMessage(d));
    this.rt.on("close", () => this.destroy());
    this.rt.on("error", () => this.destroy());
  }

  private onRealtimeMessage(data: RawData): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    const t = msg.type as string | undefined;
    if (t === "session.updated") {
      this.sessionReady = true;
    }

    if (t === "response.created") {
      const resp = msg.response as Record<string, unknown> | undefined;
      const top = msg.response_id as string | undefined;
      let id: string | undefined;
      if (typeof top === "string" && top.length > 0) id = top;
      else if (resp && typeof resp.id === "string") id = resp.id;
      if (id) {
        this.activeResponseId = id;
        this.lastResponseId = id;
      }
    }

    if (t === "response.done") {
      this.activeResponseId = null;
      this.lastResponseId = null;
    }

    if (t === "response.output_item.added") {
      const item = msg.item as Record<string, unknown> | undefined;
      if (item?.role === "assistant" && typeof item.id === "string") {
        this.assistantItemId = item.id;
        this.assistantAudioMs = 0;
      }
    }

    if (t === "conversation.item.created") {
      const item = msg.item as Record<string, unknown> | undefined;
      if (item?.role === "assistant" && typeof item.id === "string") {
        this.assistantItemId = item.id;
        this.assistantAudioMs = 0;
      }
    }

    const isAudioDelta =
      t === "response.output_audio.delta" || t === "response.audio.delta";
    if (isAudioDelta) {
      const rid = msg.response_id as string | undefined;
      if (rid) {
        this.lastResponseId = rid;
        if (!this.activeResponseId) this.activeResponseId = rid;
      }
      const itemId = msg.item_id as string | undefined;
      if (itemId) this.assistantItemId = itemId;
      const b64 = msg.delta as string | undefined;
      if (
        b64 &&
        this.streamSid &&
        this.twilioWs.readyState === WebSocket.OPEN
      ) {
        const pcm24k = base64ToPcm16(b64);
        const samples = pcm24k.length;
        this.assistantAudioMs += (samples / REALTIME_HZ) * 1000;
        const payload = pcm24kToTwilioMulawBase64(pcm24k);
        const out = {
          event: "media",
          streamSid: this.streamSid,
          media: { payload },
        };
        this.twilioWs.send(JSON.stringify(out));
      }
    }

    if (t === "input_audio_buffer.speech_started") {
      this.handleSpeechStarted();
    }

    if (t === "error") {
      console.error("realtime error:", JSON.stringify(msg));
    }
  }

  /**
   * VAD fires for each caller speech segment. Interruption only when the model
   * is / was actually speaking: we have a response id and/or we already sent
   * assistant audio to Twilio. Skipping idle speech avoids
   * response_cancel_not_active.
   */
  private handleSpeechStarted(): void {
    if (!this.streamSid || !this.rt || this.rt.readyState !== WebSocket.OPEN) {
      return;
    }

    const cancelId = this.activeResponseId ?? this.lastResponseId;
    const assistantWasAudible =
      this.assistantAudioMs > 0 || Boolean(cancelId);

    if (!assistantWasAudible) {
      return;
    }

    if (this.twilioWs.readyState === WebSocket.OPEN) {
      this.twilioWs.send(
        JSON.stringify({ event: "clear", streamSid: this.streamSid }),
      );
    }

    if (cancelId) {
      this.rt.send(
        JSON.stringify({
          type: "response.cancel",
          response_id: cancelId,
        }),
      );
    } else if (this.assistantAudioMs > 0) {
      this.rt.send(JSON.stringify({ type: "response.cancel" }));
    }

    if (this.assistantItemId && this.assistantAudioMs > 0) {
      const endMs = Math.max(0, Math.floor(this.assistantAudioMs));
      this.rt.send(
        JSON.stringify({
          type: "conversation.item.truncate",
          item_id: this.assistantItemId,
          content_index: 0,
          audio_end_ms: endMs,
        }),
      );
    }
    this.assistantAudioMs = 0;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sessionReady = false;
    if (this.rt && this.rt.readyState === WebSocket.OPEN) {
      this.rt.close();
    }
    this.rt = null;
  }
}
