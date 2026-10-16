/**
 * KAVACH Live Feed — External Tool Sender
 * 
 * Copy this snippet into ANY other web tool / Node.js script / browser console
 * to push radio packets into the KAVACH Live Feed in real-time.
 * 
 * The KAVACH backend must be running:
 *   cd kavach-decoder/backend && uvicorn main:app --reload --port 8000
 */

const KAVACH_INGEST_URL = "http://localhost:8000/ingest";

/**
 * Send one or more radio packets to KAVACH Live Feed.
 * 
 * @param {Array|Object} packets  - array of {activeRadio, messagePayload} objects
 * @param {string}       source   - label shown in the feed (e.g. "my-tool", "mqtt-bridge")
 */
async function sendToKavach(packets, source = "external") {
  const body = {
    packets: Array.isArray(packets) ? packets : [packets],
    source,
    source_id: navigator?.userAgent?.slice(0, 20) || "external",
  };

  const res = await fetch(KAVACH_INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`KAVACH ingest failed: ${res.status}`);
  return await res.json();
}

// ─── EXAMPLE: Send a single packet ─────────────────────────────────────────
sendToKavach(
  { activeRadio: "0xF1", messagePayload: "D3900C103039407CFA80C8C9040413501800000000000000006B293B76" },
  "my-radio-tool"
).then(r => console.log("Ingested:", r));


// ─── EXAMPLE: Send a batch every 2 seconds (simulates real radio) ──────────
const mockPackets = [
  { activeRadio: "0xF1", messagePayload: "D3900C103039407CFA80C8C9040413501800000000000000006B293B76" },
  { activeRadio: "0xF1", messagePayload: "B32D62101AF41009783FF74CECE4D03DA37EFEEB7E11D23192CE" },
];

let idx = 0;
setInterval(async () => {
  const pkt = mockPackets[idx % mockPackets.length];
  idx++;
  try {
    const result = await sendToKavach(pkt, "simulation");
    console.log(`[${new Date().toLocaleTimeString()}] Sent packet ${idx}:`, result);
  } catch (e) {
    console.error("Send failed:", e.message);
  }
}, 2000); // every 2 seconds, matching KAVACH frame cycle


// ─── EXAMPLE: Send from another WebSocket source ───────────────────────────
// If your tool receives packets via its own WebSocket:
// 
// const myWs = new WebSocket("ws://your-radio-system:9999");
// myWs.onmessage = (evt) => {
//   const raw = JSON.parse(evt.data);
//   sendToKavach({ activeRadio: raw.radio, messagePayload: raw.hex }, "radio-ws");
// };