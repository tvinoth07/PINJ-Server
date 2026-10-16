# ═══════════════════════════════════════════════════════════════════════════
#  SVK SIM — MISSING ENDPOINTS
#  Append these to the bottom of your existing main.py
#  (after the last existing @app route)
#
#  Adds:
#    POST /svk/encode_storyboard_csv   ← was causing 404
#    POST /svk/transmit_storyboard_csv
#    POST /svk/transmit_stop
#    POST /live/inject                 ← broadcasts decoded pkt to WS clients
# ═══════════════════════════════════════════════════════════════════════════

import ctypes as _ctypes

# ── Pull encode / transmit functions from svk_sim_bridge ─────────────────
# svk_sim_bridge.py already loads svk_sim.so.  We import the extra symbols
# that were NOT imported at the top of main.py.
try:
    from svk_sim_bridge import (
        encode_storyboard_csv      as _svk_encode_csv,
        transmit_storyboard_csv_blocking as _svk_transmit_blocking,
        stop_transmit              as _svk_stop,
    )
    _SVK_ENCODE_OK = True
except Exception as _enc_err:
    _SVK_ENCODE_OK = False
    _enc_err_msg   = str(_enc_err)


# ── Pydantic models for new endpoints ────────────────────────────────────

class EncodeCsvPayload(BaseModel):
    csv: str


class TransmitCsvPayload(BaseModel):
    csv:       str
    dest_ip:   str  = "127.0.0.1"
    dest_port: int  = 12345
    loop:      bool = False


class LiveInjectPayload(BaseModel):
    hex:         str
    activeRadio: str = "0xF1"
    source:      str = "SVK_SIM"


# ── POST /svk/encode_storyboard_csv ──────────────────────────────────────

@app.post("/svk/encode_storyboard_csv")
async def svk_encode_storyboard_csv(payload: EncodeCsvPayload):
    """
    Encode a StoryBoard CSV → list of KAVACH hex packets via svk_sim.c.
    Called by SvkSim.jsx on every TRANSMIT STORYBOARD click.

    Returns:
        { "data": [ { row, line_num, tdma_slot, frame_num,
                       pkt_type, pkt_type_name, byte_len, hex, error }, … ] }
    """
    if not SVK_AVAILABLE or not _SVK_ENCODE_OK:
        err = _svk_err_msg if not SVK_AVAILABLE else _enc_err_msg
        raise HTTPException(status_code=503,
                            detail=f"SVK SIM C library not available: {err}")
    if not payload.csv or not payload.csv.strip():
        raise HTTPException(status_code=400, detail="Empty CSV payload")
    try:
        result = _svk_encode_csv(payload.csv)
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── POST /svk/transmit_storyboard_csv ────────────────────────────────────

@app.post("/svk/transmit_storyboard_csv")
async def svk_transmit_storyboard_csv(payload: TransmitCsvPayload):
    """
    Run the full TDMA-paced UDP transmission in a thread-pool executor so
    FastAPI doesn't block.  Abort with POST /svk/transmit_stop.
    """
    if not SVK_AVAILABLE or not _SVK_ENCODE_OK:
        raise HTTPException(status_code=503, detail="SVK SIM not available")
    if not payload.csv or not payload.csv.strip():
        raise HTTPException(status_code=400, detail="Empty CSV payload")
    try:
        loop = asyncio.get_event_loop()
        rc = await loop.run_in_executor(
            None,
            _svk_transmit_blocking,
            payload.csv,
            payload.dest_ip,
            payload.dest_port,
            int(payload.loop),
        )
        if rc == 0:
            return {"status": "done"}
        if rc == -3:
            return {"status": "done_with_errors", "rc": rc}
        raise HTTPException(status_code=500, detail=f"C layer returned {rc}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── POST /svk/transmit_stop ───────────────────────────────────────────────

@app.post("/svk/transmit_stop")
async def svk_transmit_stop():
    """Signal a running transmit_storyboard_csv to abort."""
    if not SVK_AVAILABLE or not _SVK_ENCODE_OK:
        raise HTTPException(status_code=503, detail="SVK SIM not available")
    try:
        _svk_stop()
        return {"status": "stopped"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── POST /live/inject ─────────────────────────────────────────────────────

@app.post("/live/inject")
async def live_inject(payload: LiveInjectPayload):
    """
    Decode one raw KAVACH hex packet and broadcast it to every connected
    WebSocket client as { type:"packet", data:<decoded> }.

    SvkSim.jsx calls this once per packet per 2-second TDMA frame so that
    SVK SIM encoded packets appear live on the Decode LIVE page in real time.

    Uses the same pipeline() / broadcast() / live_subscribers as the rest
    of main.py — no separate connection list needed.
    """
    global packet_counter

    if not payload.hex or not payload.hex.strip():
        raise HTTPException(status_code=400, detail="Empty hex payload")

    pkt_list = [{
        "activeRadio":    payload.activeRadio,
        "messagePayload": payload.hex.strip(),
    }]

    try:
        # Re-use the existing pipeline: decode → enrich → store → broadcast
        results = await pipeline(pkt_list, payload.source, "SVK_SIM")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Decode/broadcast error: {e}")

    if results:
        # Tag the packet so LiveTab can badge it distinctly
        results[0]["_svk_sim"] = True
        results[0]["source"]   = payload.source

    return {
        "status":   "ok",
        "injected": len(results),
        "subscribers_notified": len(live_subscribers),
    }
