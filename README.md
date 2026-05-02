# OpenAI Realtime + Twilio Voice bridge

**Status:** working prototype — end-to-end PSTN calls verified with Twilio + tunnel
+ Azure OpenAI Realtime (`gpt-realtime` deployment). Harden for production
(TLS on VM, key rotation, interrupt tuning).

Public repo: [github.com/RidSib/realtime-phonecalls](https://github.com/RidSib/realtime-phonecalls).

Node.js service that connects **Twilio Media Streams** (phone audio) to the
**OpenAI Realtime API** or **Azure OpenAI Realtime** over WebSockets. No SIP.

## Requirements

- Node.js 20+
- Twilio account and voice-capable number
- OpenAI API key, or Azure OpenAI resource with a **realtime** model deployment
- A **public HTTPS / WSS URL** (ngrok, Cloudflare Tunnel, or your VM with TLS)

## Quick start (local)

1. Copy [`.env.example`](.env.example) to `.env` and fill in values.

2. Install and run:

   ```bash
   npm install
   npm run dev
   ```

3. Expose the app (example: ngrok):

   ```bash
   ngrok http 5050
   ```

4. Set `PUBLIC_URL` to the **https** origin ngrok prints (no path, no trailing
   slash), restart the bridge, then configure Twilio:

   - **Phone number → Voice & Fax → A call comes in:** Webhook, HTTP POST, URL
     `https://<your-host>/voice`
   - Use the same base host in `PUBLIC_URL` as Twilio uses, or signature
     checks will fail. If needed, set `TWILIO_VALIDATE_SIGNATURE=false` only
     while debugging.

5. Call the number. The bridge answers with TwiML that starts a **media
   stream** to `wss://<same-host>/media` and pipes audio to Realtime.

## Environment

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `PUBLIC_URL` | yes | `https://…` base that Twilio hits (TwilioML + WSS). |
| `PORT` | no | HTTP + WebSocket server port (default `5050`). |
| `REALTIME_PROVIDER` | no | `openai` (default) or `azure`. |
| `OPENAI_API_KEY` | if openai | OpenAI API key. |
| `OPENAI_REALTIME_MODEL` | no | Default `gpt-realtime`. |
| `AZURE_OPENAI_ENDPOINT` | if azure | e.g. `https://res.openai.azure.com` |
| `AZURE_OPENAI_API_KEY` | if azure | Azure key. |
| `AZURE_OPENAI_DEPLOYMENT_NAME` | if azure | Realtime **deployment** name. |
| `TWILIO_AUTH_TOKEN` | yes | From Twilio console. |
| `TWILIO_VALIDATE_SIGNATURE` | no | `true` (default) or `false` for debug. |
| `REALTIME_VOICE` | no | Realtime output voice (default `alloy`). |
| `ASSISTANT_INSTRUCTIONS` | no | System instructions for the model. |

See [Microsoft: Realtime over WebSockets](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/realtime-audio-websockets)
for Azure URL and `api-key` auth (used by this app).

## Production (e.g. Clawless Azure VM)

### Next to OpenClaw (Clawless)

OpenClaw stays **as-is** (gateway on **18789**). The voice bridge is a **second
process** on the same VM; you can reuse the **same Azure OpenAI** Realtime
deployment keys in **`AZURE_*`** env vars.

**Prerequisites:** SSH as `dev`, Node 20 (Clawless `cloud-init` installs it).
Twilio needs a **public HTTPS URL** for `/voice` and **WSS** for `/media`.
Default Clawless Azure NSG often allows only **22** and **18789** — add **443**
(or use **Cloudflare Tunnel / ngrok** on the VM so you do not open inbound
ports).

### Install on the VM (automated)

```bash
git clone https://github.com/RidSib/realtime-phonecalls.git
cd realtime-phonecalls
sudo ./scripts/install-on-vm.sh
```

This clones or pulls under **`/home/dev/realtime-phonecalls`**, runs
**`npm ci && npm run build`**, installs **`deploy/systemd/realtime-voice.service`**,
and seeds **`/etc/realtime-voice.env`** from **`.env.example`** if missing.

1. **Edit secrets:** `sudo nano /etc/realtime-voice.env` — set **`PUBLIC_URL`**
   (`https://…`, no trailing slash), **`TWILIO_AUTH_TOKEN`**, and OpenAI or Azure
   Realtime vars (see **Environment**).

2. **TLS** in front of **`127.0.0.1:5050`** — Caddy/nginx + Let’s Encrypt, or a
   tunnel; **`PUBLIC_URL`** must match what Twilio uses.

3. **Start:** `sudo systemctl enable --now realtime-voice` (or
   **`sudo ./scripts/install-on-vm.sh --start`** once env is valid.)

4. **Twilio:** Voice webhook **POST** **`https://<public-host>/voice`**.

5. **Updates:** `cd ~/realtime-phonecalls && git pull && npm ci && npm run build && sudo systemctl restart realtime-voice`

## Endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/health` | Liveness JSON `{ ok: true }`. |
| POST | `/voice` | Twilio voice webhook → TwiML `<Connect><Stream>`. |
| WebSocket | `/media` | Twilio bidirectional Media Stream (mu-law 8 kHz). |

Audio is converted **mu-law 8 kHz ↔ PCM 24 kHz** to match Realtime.

## Interruptions

On `input_audio_buffer.speech_started`, the bridge sends **clear** to Twilio,
**response.cancel** to Realtime, and **conversation.item.truncate** when an
assistant item id and audio duration are known.

## Scripts

- `npm run dev` — watch mode with `tsx`
- `npm run build` — compile to `dist/`
- `npm start` — run `node dist/index.js`
- `scripts/install-on-vm.sh` — clone/pull, build, systemd on Ubuntu (Clawless VM)
