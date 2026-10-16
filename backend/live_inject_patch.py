"""
live_inject_patch.py
────────────────────
ADD THIS TO YOUR main.py (FastAPI backend).

This is the missing endpoint that SvkSim.jsx calls to push encoded
packets from the SVK SIM into the Decode LIVE page WebSocket feed.

How it works:
  SvkSim encodes a StoryBoard CSV → list of hex packets.
  For each TDMA frame (2s), SvkSim POSTs every packet's hex here.
  This endpoint decodes the hex (same engine as /decode) and broadcasts
  { type:"packet", data:decoded } to every connected WebSocket client.
  The LiveTab in App.jsx already listens for exactly this message shape.

Paste this block into your existing main.py alongside the other routes.
You may already have the `active_connections` list and the WebSocket
`/ws/live` handler — if so, just add the POST route below.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import asyncio, json

# ─── If you don't already have this, add it near the top of main.py ──────────
# active_connections: list[WebSocket] = []

# ─── Paste this route into your router / main.py ─────────────────────────────

class InjectPayload(BaseModel):
    hex:         str           # raw KAVACH payload hex (no radio framing prefix)
    activeRadio: str  = "0xF1"
    source:      str  = "SVK_SIM"

@router.post("/live/inject")
async def live_inject(body: InjectPayload):
    """
    Decode a single raw hex packet and broadcast it to all live WebSocket
    clients as { type:"packet", data: <decoded> }.

    Called by SvkSim.jsx once per packet per TDMA frame.
    """
    try:
        # Re-use whatever decoder your /decode endpoint uses.
        # Example with the python3.py module already imported:
        from python3 import decode_packet   # adjust import to match your project
        decoded = decode_packet(
            {"activeRadio": body.activeRadio, "messagePayload": body.hex},
            packet_index=0,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Decode error: {e}")

    # Tag the packet so the LiveTab can distinguish SVK_SIM packets
    decoded["source"]   = body.source
    decoded["_svk_sim"] = True

    # Broadcast to all live WebSocket connections
    msg = json.dumps({"type": "packet", "data": decoded})
    dead = []
    for ws in active_connections:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        active_connections.remove(ws)

    return {"status": "ok", "injected": 1}


# ─── If you already have a /ws/live WebSocket endpoint, it should look ───────
# roughly like this (already present in most setups):

# from fastapi import WebSocket, WebSocketDisconnect
#
# @app.websocket("/ws/live")
# async def ws_live(websocket: WebSocket):
#     await websocket.accept()
#     active_connections.append(websocket)
#     try:
#         while True:
#             await websocket.receive_text()   # keep alive
#     except WebSocketDisconnect:
#         active_connections.remove(websocket)


# ─── Quick-start: if you do NOT have a WebSocket endpoint yet ────────────────
# Add this to main.py to create a minimal live WebSocket + inject combo:
#
# from fastapi import FastAPI, WebSocket, WebSocketDisconnect
# app = FastAPI()
# active_connections: list[WebSocket] = []
#
# @app.websocket("/ws/live")
# async def ws_live(ws: WebSocket):
#     await ws.accept()
#     active_connections.append(ws)
#     await ws.send_json({"type": "connected", "data": {"total_packets": 0}})
#     try:
#         while True:
#             await ws.receive_text()
#     except WebSocketDisconnect:
#         if ws in active_connections:
#             active_connections.remove(ws)
