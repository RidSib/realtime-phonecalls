# OpenAI Realtime + Twilio Voice bridge

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

1. `git clone` or `git pull` this repo on the VM and build:

   ```bash
   cd ~/realtime_voice_twilio
   npm ci
   npm run build
   ```

2. Put secrets in a file **outside** git, e.g. `/etc/realtime-voice.env`:

   ```bash
   PUBLIC_URL=https://voice.example.com
   REALTIME_PROVIDER=azure
   AZURE_OPENAI_ENDPOINT=https://...
   AZURE_OPENAI_API_KEY=...
   AZURE_OPENAI_DEPLOYMENT_NAME=...
   TWILIO_AUTH_TOKEN=...
   PORT=5050
   ```

3. Run behind **TLS** (Caddy or nginx with Let’s Encrypt) so `PUBLIC_URL` is
   `https://` and `wss://` works. Open the firewall / NSG for 443 (and proxy to
   `127.0.0.1:5050`).

4. **systemd** example (`/etc/systemd/system/realtime-voice.service`):

   ```ini
   [Unit]
   Description=Realtime Twilio Voice bridge
   After=network.target

   [Service]
   Type=simple
   WorkingDirectory=/home/you/realtime_voice_twilio
   EnvironmentFile=/etc/realtime-voice.env
   ExecStart=/usr/bin/node dist/index.js
   Restart=always
   User=you

   [Install]
   WantedBy=multi-user.target
   ```

   Then: `sudo systemctl daemon-reload`, `sudo systemctl enable --now
   realtime-voice`.

5. Point your Twilio voice webhook at `https://your-domain/voice`.

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
