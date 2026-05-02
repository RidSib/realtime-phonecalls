import http from "http";
import express from "express";
import twilio from "twilio";
import { WebSocketServer } from "ws";
import type { AppConfig } from "./config.js";
import { voiceWebhookUrl } from "./config.js";
import { CallBridge } from "./callBridge.js";

export function createServer(cfg: AppConfig): http.Server {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.post("/voice", (req, res) => {
    const webhookUrl = voiceWebhookUrl(cfg);
    if (cfg.twilioValidateSignature) {
      const sig = req.headers["x-twilio-signature"];
      if (!sig || typeof sig !== "string") {
        res.status(403).send("missing signature");
        return;
      }
      const ok = twilio.validateRequest(
        cfg.twilioAuthToken,
        sig,
        webhookUrl,
        req.body as Record<string, string>,
      );
      if (!ok) {
        res.status(403).send("bad signature");
        return;
      }
    }

    const host = cfg.publicUrl.trim();
    const wsBase = host.startsWith("https://")
      ? `wss://${host.slice("https://".length)}`
      : host.startsWith("http://")
        ? `ws://${host.slice("http://".length)}`
        : `wss://${host}`;
    const streamUrl = `${wsBase.replace(/\/$/, "")}/media`;

    const vr = new twilio.twiml.VoiceResponse();
    const connect = vr.connect();
    connect.stream({ url: streamUrl });
    res.type("text/xml");
    res.send(vr.toString());
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/media" });

  wss.on("connection", (ws) => {
    new CallBridge(ws, cfg);
  });

  return server;
}
