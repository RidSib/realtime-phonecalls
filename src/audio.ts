import { mulaw } from "alawmulaw";

/** Twilio Media Streams: 8 kHz mu-law; Realtime pcm16 is typically 24 kHz. */
export const TWILIO_HZ = 8000;
export const REALTIME_HZ = 24000;

/** Decode base64 mu-law (8 kHz) to PCM16 , then upsample to 24 kHz. */
export function twilioMulawBase64ToPcm24k(b64: string): Int16Array {
  const raw = Buffer.from(b64, "base64");
  const pcm8 = mulaw.decode(new Uint8Array(raw));
  return upsample8kTo24k(pcm8);
}

/** Downsample 24 kHz PCM16 to 8 kHz, encode mu-law, return base64 */
export function pcm24kToTwilioMulawBase64(pcm24k: Int16Array): string {
  const pcm8 = downsample24kTo8k(pcm24k);
  const encoded = mulaw.encode(pcm8);
  return Buffer.from(encoded).toString("base64");
}

/** Linear upsample 8 kHz → 24 kHz (exact 3×). */
export function upsample8kTo24k(pcm8k: Int16Array): Int16Array {
  const outLen = pcm8k.length * 3;
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i / 3;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, pcm8k.length - 1);
    const frac = srcPos - i0;
    const s0 = pcm8k[i0]!;
    const s1 = pcm8k[i1]!;
    out[i] = Math.round(s0 + frac * (s1 - s0));
  }
  return out;
}

/** Downsample 24 kHz → 8 kHz (take blocks of 3, average). */
export function downsample24kTo8k(pcm24k: Int16Array): Int16Array {
  const outLen = Math.floor(pcm24k.length / 3);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const b = i * 3;
    const a0 = pcm24k[b] ?? 0;
    const a1 = pcm24k[b + 1] ?? a0;
    const a2 = pcm24k[b + 2] ?? a1;
    out[i] = Math.round((a0 + a1 + a2) / 3);
  }
  return out;
}

/** PCM16 bytes from Int16Array */
export function pcm16ToBase64(pcm: Int16Array): string {
  const buf = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    buf.writeInt16LE(pcm[i]!, i * 2);
  }
  return buf.toString("base64");
}

/** Base64 PCM16 to Int16Array */
export function base64ToPcm16(b64: string): Int16Array {
  const buf = Buffer.from(b64, "base64");
  const n = Math.floor(buf.length / 2);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = buf.readInt16LE(i * 2);
  }
  return out;
}
