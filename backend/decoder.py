"""
KAVACH Radio Packet Decoder — Full Implementation
RDSO/SPN/196/2020 Version 4.0 Annexure-C  (Amdt-10, effective 27.06.2024)

Supported packet types:
  0b1001 (9)  → C.4.2  Station / ILC / IBS to Onboard Regular Packet
  0b1010 (10) → C.4.3  Onboard to Station Regular Packet
  0b1011 (11) → C.4.4  Access Authority Packet Version 2.0
  0b1100 (12) → C.4.5  Additional Emergency Packet
  0b1101 (13) → C.4.6  Onboard Access Request Packet
"""

from typing import Any


# ── CRC-32 IEEE (MISRA-C compatible, matches python3.py specification) ──────
# Polynomial : 0x04C11DB7  (reversed: 0xEDB88320)
# Initial CRC: 0x00000000
# Final XOR  : 0x00000000
# Input/Result reflected: True

_CRC32_TABLE = [
    0x00000000, 0x77073096, 0xEE0E612C, 0x990951BA, 0x076DC419, 0x706AF48F, 0xE963A535, 0x9E6495A3,
    0x0EDB8832, 0x79DCB8A4, 0xE0D5E91E, 0x97D2D988, 0x09B64C2B, 0x7EB17CBD, 0xE7B82D07, 0x90BF1D91,
    0x1DB71064, 0x6AB020F2, 0xF3B97148, 0x84BE41DE, 0x1ADAD47D, 0x6DDDE4EB, 0xF4D4B551, 0x83D385C7,
    0x136C9856, 0x646BA8C0, 0xFD62F97A, 0x8A65C9EC, 0x14015C4F, 0x63066CD9, 0xFA0F3D63, 0x8D080DF5,
    0x3B6E20C8, 0x4C69105E, 0xD56041E4, 0xA2677172, 0x3C03E4D1, 0x4B04D447, 0xD20D85FD, 0xA50AB56B,
    0x35B5A8FA, 0x42B2986C, 0xDBBBC9D6, 0xACBCF940, 0x32D86CE3, 0x45DF5C75, 0xDCD60DCF, 0xABD13D59,
    0x26D930AC, 0x51DE003A, 0xC8D75180, 0xBFD06116, 0x21B4F4B5, 0x56B3C423, 0xCFBA9599, 0xB8BDA50F,
    0x2802B89E, 0x5F058808, 0xC60CD9B2, 0xB10BE924, 0x2F6F7C87, 0x58684C11, 0xC1611DAB, 0xB6662D3D,
    0x76DC4190, 0x01DB7106, 0x98D220BC, 0xEFD5102A, 0x71B18589, 0x06B6B51F, 0x9FBFE4A5, 0xE8B8D433,
    0x7807C9A2, 0x0F00F934, 0x9609A88E, 0xE10E9818, 0x7F6A0DBB, 0x086D3D2D, 0x91646C97, 0xE6635C01,
    0x6B6B51F4, 0x1C6C6162, 0x856530D8, 0xF262004E, 0x6C0695ED, 0x1B01A57B, 0x8208F4C1, 0xF50FC457,
    0x65B0D9C6, 0x12B7E950, 0x8BBEB8EA, 0xFCB9887C, 0x62DD1DDF, 0x15DA2D49, 0x8CD37CF3, 0xFBD44C65,
    0x4DB26158, 0x3AB551CE, 0xA3BC0074, 0xD4BB30E2, 0x4ADFA541, 0x3DD895D7, 0xA4D1C46D, 0xD3D6F4FB,
    0x4369E96A, 0x346ED9FC, 0xAD678846, 0xDA60B8D0, 0x44042D73, 0x33031DE5, 0xAA0A4C5F, 0xDD0D7CC9,
    0x5005713C, 0x270241AA, 0xBE0B1010, 0xC90C2086, 0x5768B525, 0x206F85B3, 0xB966D409, 0xCE61E49F,
    0x5EDEF90E, 0x29D9C998, 0xB0D09822, 0xC7D7A8B4, 0x59B33D17, 0x2EB40D81, 0xB7BD5C3B, 0xC0BA6CAD,
    0xEDB88320, 0x9ABFB3B6, 0x03B6E20C, 0x74B1D29A, 0xEAD54739, 0x9DD277AF, 0x04DB2615, 0x73DC1683,
    0xE3630B12, 0x94643B84, 0x0D6D6A3E, 0x7A6A5AA8, 0xE40ECF0B, 0x9309FF9D, 0x0A00AE27, 0x7D079EB1,
    0xF00F9344, 0x8708A3D2, 0x1E01F268, 0x6906C2FE, 0xF762575D, 0x806567CB, 0x196C3671, 0x6E6B06E7,
    0xFED41B76, 0x89D32BE0, 0x10DA7A5A, 0x67DD4ACC, 0xF9B9DF6F, 0x8EBEEFF9, 0x17B7BE43, 0x60B08ED5,
    0xD6D6A3E8, 0xA1D1937E, 0x38D8C2C4, 0x4FDFF252, 0xD1BB67F1, 0xA6BC5767, 0x3FB506DD, 0x48B2364B,
    0xD80D2BDA, 0xAF0A1B4C, 0x36034AF6, 0x41047A60, 0xDF60EFC3, 0xA867DF55, 0x316E8EEF, 0x4669BE79,
    0xCB61B38C, 0xBC66831A, 0x256FD2A0, 0x5268E236, 0xCC0C7795, 0xBB0B4703, 0x220216B9, 0x5505262F,
    0xC5BA3BBE, 0xB2BD0B28, 0x2BB45A92, 0x5CB36A04, 0xC2D7FFA7, 0xB5D0CF31, 0x2CD99E8B, 0x5BDEAE1D,
    0x9B64C2B0, 0xEC63F226, 0x756AA39C, 0x026D930A, 0x9C0906A9, 0xEB0E363F, 0x72076785, 0x05005713,
    0x95BF4A82, 0xE2B87A14, 0x7BB12BAE, 0x0CB61B38, 0x92D28E9B, 0xE5D5BE0D, 0x7CDCEFB7, 0x0BDBDF21,
    0x86D3D2D4, 0xF1D4E242, 0x68DDB3F8, 0x1FDA836E, 0x81BE16CD, 0xF6B9265B, 0x6FB077E1, 0x18B74777,
    0x88085AE6, 0xFF0F6A70, 0x66063BCA, 0x11010B5C, 0x8F659EFF, 0xF862AE69, 0x616BFFD3, 0x166CCF45,
    0xA00AE278, 0xD70DD2EE, 0x4E048354, 0x3903B3C2, 0xA7672661, 0xD06016F7, 0x4969474D, 0x3E6E77DB,
    0xAED16A4A, 0xD9D65ADC, 0x40DF0B66, 0x37D83BF0, 0xA9BCAE53, 0xDEBB9EC5, 0x47B2CF7F, 0x30B5FFE9,
    0xBDBDF21C, 0xCABAC28A, 0x53B39330, 0x24B4A3A6, 0xBAD03605, 0xCDD70693, 0x54DE5729, 0x23D967BF,
    0xB3667A2E, 0xC4614AB8, 0x5D681B02, 0x2A6F2B94, 0xB40BBE37, 0xC30C8EA1, 0x5A05DF1B, 0x2D02EF8D,
]


def calculate_crc32_ieee(data_bytes: bytes) -> int:
    """
    CRC-32 IEEE matching the KAVACH RDSO/SPN/196/2020 specification.
    Initial value 0x00000000, no final XOR, input/result reflected.
    Identical to the MISRA-C crc32.c reference in python3.py.
    """
    crc = 0x00000000
    for byte in data_bytes:
        table_index = (crc ^ byte) & 0xFF
        crc = (crc >> 8) ^ _CRC32_TABLE[table_index]
    return crc & 0xFFFFFFFF


def verify_packet_crc(payload_hex: str) -> dict:
    """
    Verify the CRC-32 of a raw KAVACH packet hex string.

    The CRC covers all bytes of the packet EXCEPT the last 4 bytes
    (the PKT_CRC field itself).  If a MAC_CODE (4 bytes) precedes the
    CRC it is included in the covered data — only the final 4-byte
    CRC field is excluded.

    Returns a dict with keys:
        match        – True / False
        computed_hex – computed CRC as '0xXXXXXXXX'
        stored_hex   – stored CRC as '0xXXXXXXXX'
        error        – present only when verification could not be run
    """
    try:
        clean = payload_hex.replace("0x", "").replace("0X", "").replace(" ", "").strip()
        data = bytes.fromhex(clean)
    except Exception as e:
        return {"match": False, "error": f"Invalid hex payload: {e}"}

    if len(data) < 5:          # need at least 1 data byte + 4 CRC bytes
        return {"match": False, "error": "Payload too short to contain CRC"}

    # Last 4 bytes are the stored CRC (little-endian in the bit stream,
    # but here we treat the 4 raw bytes as a big-endian 32-bit word
    # because hex_to_bits feeds MSB-first).
    covered  = data[:-4]
    stored_bytes = data[-4:]
    stored_crc   = int.from_bytes(stored_bytes, "big")

    computed_crc = calculate_crc32_ieee(covered)
    match = (computed_crc == stored_crc)
    return {
        "match":        match,
        "computed_hex": f"0x{computed_crc:08X}",
        "stored_hex":   f"0x{stored_crc:08X}",
    }


def hex_to_bits(hex_string: str) -> str:
    clean = hex_string.replace("0x", "").replace(
        "0X", "").replace(" ", "").strip()
    return bin(int(clean, 16))[2:].zfill(len(clean) * 4)


def bits_to_int(bits: str) -> int:
    return int(bits, 2) if bits else 0


def bits_to_signed_int(bits: str) -> int:
    if not bits:
        return 0
    v = int(bits, 2)
    return v - (1 << len(bits)) if bits[0] == '1' else v


class BitReader:
    def __init__(self, bits: str):
        self.bits = bits
        self.pos = 0
        self.total = len(bits)

    def read(self, n: int) -> str:
        end = self.pos + n
        if end > self.total:
            chunk = self.bits[self.pos:] + '0' * (end - self.total)
        else:
            chunk = self.bits[self.pos:end]
        self.pos += n
        return chunk

    def read_uint(self, n: int) -> int:
        return bits_to_int(self.read(n))

    def read_sint(self, n: int) -> int:
        return bits_to_signed_int(self.read(n))

    @property
    def remaining(self) -> int:
        return max(0, self.total - self.pos)

    def peek(self, n: int) -> str:
        return self.bits[self.pos:self.pos + n]


PKT_TYPE_MAP = {
    0b1001: "Station to Onboard Regular Packet",
    0b1010: "Onboard to Station Regular Packet",
    0b1011: "Access Authority Packet",
    0b1100: "Additional Emergency Packet",
    0b1101: "Onboard Access Request",
}

KAVACH_VERSION_MAP = {
    0: "Not used",
    1: "Kavach Specification 3.2",
    2: "Kavach Specification 4.0",
}

LOCO_MODE_MAP = {
    0b0001: "Stand_By",            0b0010: "Staff_Responsible_Mode",
    0b0011: "Limited_Supervision", 0b0100: "Full_Supervision",
    0b0101: "Override",            0b0110: "On_Sight",
    0b0111: "Trip",                0b1000: "Post_Trip",
    0b1001: "Reverse",             0b1010: "Shunting",
    0b1011: "Non_Leading",         0b1100: "System_Failure",
    0b1101: "Isolation",
}

EMERGENCY_STATUS_MAP = {
    0b000: "No Emergency - Regular Packet",
    0b001: "Unusual Stoppage / Side Collision",
    0b010: "SoS",
    0b011: "Roll Back Detected",
    0b100: "Head On Collision",
    0b101: "Rear End Collision",
    0b110: "Parting SoS",
    0b111: "Spare",
}

MOVEMENT_DIR_MAP = {
    0b00: "Traffic Direction not established / unidentified",
    0b01: "Nominal (DOWN direction)",
    0b10: "Reverse (UP direction)",
    0b11: "Reserved for future use",
}

DEST_LOCO_SOS_MAP = {
    0b0000: "No SoS / Emergency",
    0b0001: "Foreign RFID",
    0b0010: "Reserved",
    0b0011: "Onboard Odo error >= 120 m",
    0b0100: "Detection of SPAD",
    0b0101: "Rear-end collision",
    0b0110: "Head-On collision",
    0b0111: "Violation of Shunting limits in shunt mode",
    0b1000: "Station General SoS",
}

TRAIN_SECTION_MAP = {
    0b00: "Station Section",
    0b01: "Absolute Block",
    0b10: "Autoblock",
    0b11: "Reserved",
}

AUTHORITY_TYPE_MAP = {
    0b00: "Not to be used",
    0b01: "OS Authority (On-Sight mode with speed restriction)",
    0b10: "FS Authority (Full Supervision mode)",
    0b11: "SR Authority (Staff Responsible)",
}

TRACK_COND_MAP = {
    0b0000: "Not used",
    0b0001: "Dead Stop",
    0b0010: "Radio hole",
    0b0011: "Non stopping area",
    0b0100: "Tunnel stopping area",
    0b0101: "Powerless section (Neutral section)",
    0b0110: "Sound horn",
    0b0111: "Reversing area",
    0b1000: "Fouling Mark location",
    0b1001: "KAVACH Territory Exit",
}

SUB_PKT_TYPE_MAP = {
    0b0000: "Movement Authority",
    0b0001: "Static Speed Profile",
    0b0010: "Gradient Profile",
    0b0011: "LC Gate Profile",
    0b0100: "Turnout Speed Profile",
    0b0101: "Tag Linking Information",
    0b0110: "Track Condition Data",
    0b0111: "Temporary Speed Restrictions Profile",
}

TSR_STATUS_MAP = {
    0b00: "No applicable TSR for current MA",
    0b01: "No Latest TSR Information (Onboard -> SR Mode)",
    0b10: "Latest TSR Information present",
    0b11: "Reserved",
}

TRAIN_INT_MAP = {
    0b00: "No Train Integrity information available",
    0b01: "Train integrity confirmed by integrity monitoring device",
    0b10: "Train integrity confirmed by Loco Pilot",
    0b11: "Reserved",
}

INFO_ACK_MAP = {
    0:  "No Ack",
    1:  "Loco Specific SoS Ack by LP",
    2:  "FS to LS Ack by LP",
    3:  "LS to SR Ack by LP",
    4:  "FS to SR Ack by LP",
    5:  "OS to SR Ack by LP",
    6:  "OV to SR Ack by LP",
    7:  "Trip Ack by LP",
    8:  "PTRIP to SR Ack by LP",
    9:  "Auto horn Ack by LP",
    10: "TLM Start packet received Ack",
    11: "TLM End packet received Ack",
    12: "Unusual Stoppage Ack by LP",
    13: "Manual SoS Ack by LP",
    14: "Spare",
    15: "Spare",
}

BRAKE_APPLIED_MAP = {
    0b000: "No over speed, No brakes by Kavach",
    0b001: "Over speed but no brakes by Kavach",
    0b010: "Normal Service Brake by Kavach",
    0b011: "Full Service Brake by Kavach",
    0b100: "Emergency Brake by Kavach",
}

TAG_LINK_INFO_MAP = {
    0b000: "No Tag missing",
    0b001: "Duplicate Tag missing",
    0b010: "Main Tag missing",
    0b011: "Both Tags missing",
    0b100: "Tag position interchanged",
    0b101: "Both Tags have same location info",
    0b110: "Intertag distance less than DIST_DUP_TAG",
    0b111: "Intertag distance greater than DIST_DUP_TAG",
}


def frame_num_to_time(fn: int) -> str:
    if fn == 0:
        return "Invalid (0)"
    s = fn - 1
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


def speed_value_desc(v: int) -> str:
    if v == 0:
        return "Reserved"
    if 1 <= v <= 50:
        return f"{v * 5} kmph"
    if 51 <= v <= 61:
        return "Reserved for future use"
    if v == 62:
        return "8 kmph (auto signal override night)"
    return "Unknown"


def turnout_speed_desc(v: int) -> str:
    if v == 0b00000:
        return "Not Used"
    if 1 <= v <= 18:
        return f"Up to {v * 5} kmph"
    if v == 0b11111:
        return "Unrestricted"
    return "Reserved for future use"


def tin_desc(v: int) -> str:
    if v == 0:
        return "Ignore / Don't Care"
    if 1 <= v <= 250:
        return f"Track Identity Number = {v}"
    if v == 251:
        return "Onboard shed TIN"
    return f"Reserved ({v})"


def make_row(field, size, raw, decimal, description):
    return {"Field": field, "Size (bits)": size, "Raw Bits": raw,
            "Decimal Value": decimal, "Description": description}


def section_header(name):
    return {"Field": f"\u2500\u2500 {name} \u2500\u2500", "Size (bits)": "",
            "Raw Bits": "", "Decimal Value": "", "Description": "", "_is_section": True}


# ── Common sub-packet decoders ──────────────────────────────────────

# ── Sub-packet boundary enforcement ────────────────────────────────────────
# Each sub-packet decoder receives a BOUNDED BitReader that spans exactly the
# declared payload of that sub-packet (i.e. (SUB_PKT_LENGTH+1)*8 - 4 - 7 bits,
# because the 4-bit type and 7-bit length have already been consumed by the
# main loop before calling the decoder).  The decoder must NOT read the length
# field itself — that is handled by the caller.  Any unread bits inside the
# bounded reader are padding and are silently dropped by the caller.
#
# This guarantees each sub-packet is decoded from exactly the right window of
# bits, preventing leftover bits from leaking into subsequent sub-packets and
# being misinterpreted as new SUB_PKT_TYPE headers (the root cause of the
# duplicate sub-packet bug seen in the inspector).
# ────────────────────────────────────────────────────────────────────────────

def decode_subpkt_movement_authority(reader):
    # NOTE: length field already consumed by caller. reader is bounded.
    rows = [section_header("MOVEMENT AUTHORITY")]
    b = reader.read(4)
    v = bits_to_int(b)
    rows.append(make_row("FRAME_OFFSET", 4, b, v, f"Frame offset = {v}"))
    b = reader.read(4)
    v = bits_to_int(b)
    rows.append(make_row("DEST_LOCO_SOS", 4, b, v,
                DEST_LOCO_SOS_MAP.get(v, f"Reserved ({v})")))
    b = reader.read(2)
    v = bits_to_int(b)
    rows.append(make_row("TRAIN_SECTION_TYPE", 2, b, v,
                TRAIN_SECTION_MAP.get(v, "Reserved")))
    sig_bits = reader.read(17)
    a0_4 = bits_to_int(sig_bits[12:17])
    a5_8 = bits_to_int(sig_bits[8:12])
    a9_14 = bits_to_int(sig_bits[2:8])
    a15 = bits_to_int(sig_bits[1:2])
    a16 = bits_to_int(sig_bits[0:1])
    line_name_map = {0: "Up Signal", 1: "Down Signal", 2: "Up Fast", 3: "Down Fast",
                     8: "Up Slow", 9: "Down Slow", 10: "Up Main", 11: "Down Main",
                     12: "Up Sub", 13: "Down Sub", 14: "UP BI-Dir", 15: "DN BI-Dir"}
    sig_desc = (f"LineNum={a0_4}, LineName={line_name_map.get(a5_8, f'Code {a5_8}')}, "
                f"SigType=0b{a9_14:06b}, Override={'Running' if a15 else 'Standstill'}, "
                f"StopSig={'Yes' if a16 else 'No'}")
    rows.append(make_row("CUR_SIG_INFO", 17, sig_bits,
                bits_to_int(sig_bits), sig_desc))
    aspect_map = {0: "Unidentified", 1: "Red", 2: "Yellow (no Route Indication)",
                  3: "Yellow + Pos1 Junction Route Indication", 4: "Yellow + Pos2 Junction Route Indication",
                  5: "Yellow + Pos3 Junction Route Indication", 6: "Yellow + Pos4 Junction Route Indication",
                  7: "Yellow + Pos5 Junction Route Indication", 8: "Yellow + Pos6 Junction Route Indication",
                  9: "Yellow + Stencil type Route Indication",
                  10: "Double Yellow", 11: "Green",
                  14: "AG Marker OFF", 15: "Red+Calling-On", 48: "Stop Board/Buffer Stop"}
    b = reader.read(6)
    v = bits_to_int(b)
    rows.append(make_row("CUR_SIG_ASPECT", 6, b, v,
                aspect_map.get(v, f"Aspect code {v}")))
    b = reader.read(6)
    v = bits_to_int(b)
    rows.append(make_row("NEXT_SIG_ASPECT", 6, b, v,
                         "Undefined (current=RED)" if v == 0 else aspect_map.get(v, f"Aspect code {v}")))
    b = reader.read(15)
    v = bits_to_int(b)
    rows.append(make_row("APPR_SIG_DIST", 15, b, v,
                f"Approaching signal dist = {v} m from last ref RFID"))
    b = reader.read(2)
    auth_type = bits_to_int(b)
    rows.append(make_row("AUTHORITY_TYPE", 2, b, auth_type,
                AUTHORITY_TYPE_MAP.get(auth_type, "Unknown")))
    # AUTHORIZED_SPEED is only present when AUTHORITY_TYPE == OS (0b01).
    # For FS/SR it is omitted entirely from the bitstream — reading it
    # unconditionally here stole 6 bits from the front of MA_W_R_T_SIG
    # (and shifted every field after it) for any non-OS packet.
    if auth_type == 0b01:
        b = reader.read(6)
        v = bits_to_int(b)
        rows.append(make_row("AUTHORIZED_SPEED", 6, b, v, speed_value_desc(v)))
    else:
        rows.append(make_row("AUTHORIZED_SPEED", 0, "-", "NA",
                    "Not present (only valid for OS authority)"))
    b = reader.read(16)
    v = bits_to_int(b)
    rows.append(make_row("MA_W_R_T_SIG", 16, b, v,
                         "Unknown – SR Mode" if v == 65535 else f"MA = {v} m from signal"))
    b = reader.read(1)
    shorten = bits_to_int(b)
    rows.append(make_row("REQ_SHORTEN_MA", 1, b, shorten,
                         "Shortening MA request" if shorten else "No shortening request"))
    if shorten == 1 and reader.remaining >= 16:
        b = reader.read(16)
        v = bits_to_int(b)
        rows.append(make_row("NEW_MA", 16, b, v, f"New MA = {v} m"))
    b = reader.read(1)
    tl = bits_to_int(b)
    rows.append(make_row("TRN_LEN_INFO_STS", 1, b, tl,
                "Train Length Info follows" if tl else "No TL Info"))
    if tl == 1 and reader.remaining >= 26:
        b = reader.read(1)
        v = bits_to_int(b)
        rows.append(make_row("TRN_LEN_INFO_TYPE", 1,
                    b, v, '"END"' if v else '"START"'))
        b = reader.read(17)
        v = bits_to_int(b)
        rows.append(make_row("REF_FRAME_NUM_TLM", 17, b, v,
                    f"Ref Frame={v} → {frame_num_to_time(v)}"))
        b = reader.read(8)
        v = bits_to_int(b)
        rows.append(make_row("REF_OFFSET_INT_TLM", 8,
                    b, v, f"Offset = {v * 10} ms"))
    if reader.remaining >= 1:
        b = reader.read(1)
        nsc = bits_to_int(b)
        rows.append(make_row("NEXT_STN_COMM", 1, b, nsc,
                             "Next station handover required" if nsc else "No handover"))
        if nsc == 1 and reader.remaining >= 16:
            b = reader.read(16)
            v = bits_to_int(b)
            rows.append(make_row("APPR_STN_ILC_IBS_ID", 16, b,
                        v, f"Approaching Station ID = {v}"))
    return rows


def decode_subpkt_static_speed(reader):
    # NOTE: length field already consumed by caller. reader is bounded.
    rows = [section_header("STATIC SPEED PROFILE")]
    b = reader.read(5)
    cnt = bits_to_int(b)
    rows.append(make_row("LM_Speed_Info_CNT", 5,
                b, cnt, f"Speed entries = {cnt}"))
    for i in range(min(cnt, 31)):
        if reader.remaining < 16:
            break
        b = reader.read(15)
        v = bits_to_int(b)
        rows.append(
            make_row(f"  LM_Static_Speed_Distance[{i+1}]", 15, b, v, f"Distance = {v} m"))
        b = reader.read(1)
        cls = bits_to_int(b)
        rows.append(make_row(f"  LM_Static_Speed_Class[{i+1}]", 1, b, cls,
                             "Classified Speeds A,B,C" if cls else "Universal Speed"))
        if cls == 0:
            b = reader.read(6)
            sv = bits_to_int(b)
            rows.append(
                make_row(f"  LM_Static_Speed_Value[{i+1}]", 6, b, sv, speed_value_desc(sv)))
        else:
            for cat in ("A", "B", "C"):
                b = reader.read(6)
                sv = bits_to_int(b)
                rows.append(
                    make_row(f"  LM_Static_Speed_{cat}[{i+1}]", 6, b, sv, speed_value_desc(sv)))
    return rows


def decode_subpkt_gradient(reader):
    # NOTE: length field already consumed by caller. reader is bounded.
    rows = [section_header("GRADIENT PROFILE")]
    b = reader.read(5)
    cnt = bits_to_int(b)
    rows.append(make_row("LM_Grad_Info_CNT", 5, b,
                cnt, f"Gradient entries = {cnt}"))
    for i in range(min(cnt, 31)):
        if reader.remaining < 21:
            break
        b = reader.read(15)
        v = bits_to_int(b)
        rows.append(
            make_row(f"  LM_Gradient_Distance[{i+1}]", 15, b, v, f"Distance = {v} m"))
        b = reader.read(1)
        gdir = bits_to_int(b)
        rows.append(
            make_row(f"  LM_GDIR[{i+1}]", 1, b, gdir, "Uphill" if gdir else "Downhill"))
        b = reader.read(5)
        gval = bits_to_int(b)
        if gval == 0:
            gdesc = "Level / not steeper than 1 in 1000"
        elif gval == 31:
            gdesc = "Reserved"
        elif gval < 30:
            gdesc = f"1 in {1000 // gval} to 1 in {1000 // (gval + 1)}"
        else:
            gdesc = "Steeper than 1 in 33"
        rows.append(make_row(f"  LM_GRADIENT_VALUE[{i+1}]", 5, b, gval, gdesc))
    return rows


def decode_subpkt_lc_gate(reader):
    # NOTE: length field already consumed by caller. reader is bounded.
    rows = [section_header("LC GATE PROFILE")]
    b = reader.read(5)
    cnt = bits_to_int(b)
    rows.append(make_row("LM_LC_Info_CNT", 5, b,
                cnt, f"LC gate entries = {cnt}"))
    lc_class_map = {0: "Special", 1: "A", 2: "B1",
                    3: "B2", 4: "B", 5: "C", 6: "D", 7: "Spare"}
    for i in range(min(cnt, 31)):
        if reader.remaining < 20:
            break
        b = reader.read(15)
        v = bits_to_int(b)
        rows.append(
            make_row(f"  LM_LC_Distance[{i+1}]", 15, b, v, f"LC start dist = {v} m"))
        b = reader.read(10)
        v = bits_to_int(b)
        rows.append(
            make_row(f"  LM_LC_ID_Numeric[{i+1}]", 10, b, v, f"LC Gate #{v}"))
        b = reader.read(3)
        v = bits_to_int(b)
        sfx = {0: "-", 1: "a", 2: "b", 3: "c",
               4: "d", 5: "e", 6: "OOR", 7: "Spare"}
        rows.append(make_row(
            f"  LM_LC_ID_Alpha_Suffix[{i+1}]", 3, b, v, f"Suffix: {sfx.get(v, '?')}"))
        b = reader.read(1)
        v = bits_to_int(b)
        rows.append(make_row(
            f"  LM_LC_Manning_Type[{i+1}]", 1, b, v, "Unmanned" if v else "Manned"))
        b = reader.read(3)
        v = bits_to_int(b)
        rows.append(
            make_row(f"  LM_LC_Class[{i+1}]", 3, b, v, lc_class_map.get(v, "Unknown")))
        b = reader.read(1)
        v = bits_to_int(b)
        rows.append(make_row(
            f"  LM_LC_Auto_Whistling_Enabled[{i+1}]", 1, b, v, "Yes" if v else "No"))
        b = reader.read(2)
        v = bits_to_int(b)
        rows.append(make_row(f"  LM_LC_Auto_Whistling_Type[{i+1}]", 2, b, v,
                             {0: "Distance Based", 1: "Time Based", 2: "Configured Pattern", 3: "Spare"}.get(v, "?")))
    return rows


def decode_subpkt_turnout(reader):
    # NOTE: length field already consumed by caller. reader is bounded.
    rows = [section_header("TURNOUT SPEED PROFILE")]
    b = reader.read(2)
    cnt = bits_to_int(b)
    rows.append(make_row("TO_CNT", 2, b, cnt, f"Turnouts = {cnt}"))
    for i in range(min(cnt, 3)):
        if reader.remaining < 32:
            break
        b = reader.read(5)
        spd = bits_to_int(b)
        rows.append(
            make_row(f"  TO_SPEED[{i+1}]", 5, b, spd, turnout_speed_desc(spd)))
        b = reader.read(15)
        v = bits_to_int(b)
        rows.append(
            make_row(f"  DIFF_DIST_TO[{i+1}]", 15, b, v, f"Turnout start dist = {v} m"))
        b = reader.read(12)
        v = bits_to_int(b)
        rows.append(make_row(
            f"  TO_SPEED_REL_DIST[{i+1}]", 12, b, v, f"Turnout release dist = {v} m"))
    return rows


def decode_subpkt_tag_linking(reader):
    # NOTE: length field already consumed by caller. reader is bounded.
    rows = [section_header("TAG LINKING INFORMATION")]
    b = reader.read(4)
    v = bits_to_int(b)
    rows.append(make_row("DIST_DUP_TAG", 4, b, v,
                         "Tags < 1 m" if v == 0 else "Invalid" if v == 15 else f"Main-Dup tag dist = {v} m"))
    b = reader.read(6)
    cnt = bits_to_int(b)
    rows.append(make_row("ROUTE_RFID_CNT", 6, b, cnt,
                         "No tag (approaching danger signal)" if cnt == 0 else
                         "Reserved" if cnt == 63 else f"Expected RFID count = {cnt}"))
    for i in range(min(cnt, 62)):
        if reader.remaining < 22:
            break
        b = reader.read(11)
        v = bits_to_int(b)
        rows.append(
            make_row(f"  DIST_NXT_RFID[{i+1}]", 11, b, v, f"Dist to next RFID = {v} m"))
        b = reader.read(10)
        v = bits_to_int(b)
        rows.append(
            make_row(f"  NXT_RFID_TAG_ID[{i+1}]", 10, b, v, f"Next RFID Tag ID = {v}"))
        b = reader.read(1)
        v = bits_to_int(b)
        rows.append(make_row(f"  DUP_TAG_DIR[{i+1}]", 1, b, v,
                             "Dup Tag in Reverse Dir (-)" if v else "Dup Tag in Nominal Dir (+)"))
    if reader.remaining >= 1:
        b = reader.read(1)
        alr = bits_to_int(b)
        rows.append(make_row("ABS_LOC_RESET", 1, b, alr,
                             "Location Correction follows" if alr else "No Locational Error"))
        if alr == 1 and reader.remaining >= 40:
            b = reader.read(15)
            v = bits_to_int(b)
            rows.append(make_row("START_DIST_TO_LOC_RESET", 15, b, v,
                        f"Start dist to correction N-tag = {v} m"))
            b = reader.read(2)
            v = bits_to_int(b)
            rows.append(make_row("ADJ_LOCO_DIR", 2, b, v,
                                 {0: "Not Known", 1: "Nominal", 2: "Reverse", 3: "Deduce from Tags"}.get(v, "?")))
            b = reader.read(23)
            v = bits_to_int(b)
            rows.append(make_row("ABS_LOC_CORRECTION", 23, b,
                        v, f"New absolute location = {v} m"))
    if reader.remaining >= 3:
        b = reader.read(3)
        cnt2 = bits_to_int(b)
        rows.append(make_row("ADJ_LINE_CNT", 3, b, cnt2,
                             "No adjacent lines" if cnt2 == 0 else f"{cnt2} adjacent line(s)"))
        # One "Self TIN" entry for the loco's own line, plus one "Adjacent TIN"
        # entry per adjacent line reported in ADJ_LINE_CNT (max value of the
        # 3-bit field is 7, so at most 8 TIN entries total).
        num_tins = min(cnt2 + 1, 8)
        for j in range(num_tins):
            if reader.remaining < 9:
                break
            b = reader.read(9)
            v = bits_to_int(b)
            if j == 0:
                rows.append(
                    make_row("  LINE_TIN[1]", 9, b, v, f"Self TIN = {v}"))
            else:
                rows.append(
                    make_row(f"  LINE_TIN[{j+1}]", 9, b, v, f"Adjacent TIN[{j}] = {v}"))
    return rows


def decode_subpkt_track_condition(reader):
    # NOTE: length field already consumed by caller. reader is bounded.
    rows = [section_header("TRACK CONDITION DATA")]
    b = reader.read(4)
    cnt = bits_to_int(b)
    rows.append(make_row("TRACKCOND_CNT", 4, b,
                cnt, f"Track conditions = {cnt}"))
    for i in range(min(cnt, 15)):
        if reader.remaining < 34:
            break
        b = reader.read(4)
        tc = bits_to_int(b)
        rows.append(make_row(f"  TRACKCOND_TYPE[{i+1}]", 4, b, tc,
                             TRACK_COND_MAP.get(tc, f"Reserved ({tc})")))
        b = reader.read(15)
        v = bits_to_int(b)
        rows.append(
            make_row(f"  START_DIST_TRACKCOND[{i+1}]", 15, b, v, f"Start dist = {v} m"))
        b = reader.read(15)
        v = bits_to_int(b)
        rows.append(
            make_row(f"  LENGTH_TRACKCOND[{i+1}]", 15, b, v, f"Length = {v} m"))
    return rows


def decode_subpkt_tsr(reader):
    # NOTE: length field already consumed by caller. reader is bounded.
    rows = [section_header("TEMPORARY SPEED RESTRICTIONS")]
    b = reader.read(2)
    sts = bits_to_int(b)
    rows.append(make_row("TSR_STATUS", 2, b, sts,
                TSR_STATUS_MAP.get(sts, "Reserved")))
    if sts == 0b10:
        b = reader.read(5)
        cnt = bits_to_int(b)
        rows.append(make_row("TSR_Info_CNT", 5, b,
                    cnt, f"TSR entries = {cnt}"))
        for i in range(min(cnt, 31)):
            if reader.remaining < 31:
                break
            b = reader.read(8)
            v = bits_to_int(b)
            rows.append(make_row(f"  TSR_ID[{i+1}]", 8, b, v, f"TSR ID = {v}"))
            b = reader.read(15)
            v = bits_to_int(b)
            rows.append(
                make_row(f"  TSR_Distance[{i+1}]", 15, b, v, f"TSR start dist = {v} m"))
            b = reader.read(15)
            v = bits_to_int(b)
            rows.append(
                make_row(f"  TSR_Length[{i+1}]", 15, b, v, f"TSR length = {v} m"))
            b = reader.read(1)
            cls = bits_to_int(b)
            rows.append(make_row(f"  TSR_Class[{i+1}]", 1, b, cls,
                                 "Classified Speed" if cls else "Universal Speed"))
            if cls == 0:
                b = reader.read(6)
                sv = bits_to_int(b)
                rows.append(
                    make_row(f"  TSR_Universal_Speed[{i+1}]", 6, b, sv, speed_value_desc(sv)))
            else:
                for cat in ("A", "B", "C"):
                    b = reader.read(6)
                    sv = bits_to_int(b)
                    rows.append(
                        make_row(f"  TSR_Class{cat}_Speed[{i+1}]", 6, b, sv, speed_value_desc(sv)))
            b = reader.read(2)
            wh = bits_to_int(b)
            rows.append(make_row(f"  TSR_Whistle[{i+1}]", 2, b, wh,
                                 {0: "No Whistle", 1: "Whistle blow"}.get(wh, "Spare")))
    return rows


SUB_PKT_DECODER_MAP = {
    0b0000: decode_subpkt_movement_authority,
    0b0001: decode_subpkt_static_speed,
    0b0010: decode_subpkt_gradient,
    0b0011: decode_subpkt_lc_gate,
    0b0100: decode_subpkt_turnout,
    0b0101: decode_subpkt_tag_linking,
    0b0110: decode_subpkt_track_condition,
    0b0111: decode_subpkt_tsr,
}


# ── C.4.2  Station to Onboard Regular Packet  (PKT_TYPE = 0b1001) ──

def decode_station_to_onboard(reader):
    rows = []
    b = reader.read(10)
    v = bits_to_int(b)
    rows.append(make_row("PKT_LENGTH", 10, b, v,
                f"Packet Length = {v+1} bytes"))
    b = reader.read(17)
    v = bits_to_int(b)
    rows.append(make_row("FRAME_NUM", 17, b, v,
                f"Frame Number = {v}  →  {frame_num_to_time(v)}"))
    b = reader.read(16)
    v = bits_to_int(b)
    rows.append(make_row("SOURCE_STN_ILC_IBS_ID", 16,
                b, v, f"Station/ILC/IBS ID = {v}"))
    b = reader.read(3)
    v = bits_to_int(b)
    rows.append(make_row("SOURCE_STN_ILC_IBS_VERSION", 3, b, v,
                KAVACH_VERSION_MAP.get(v, f"Reserved ({v})")))
    b = reader.read(20)
    v = bits_to_int(b)
    rows.append(make_row("DEST_LOCO_ID", 20, b, v,
                         f"Destination Loco ID = {v}" + (" (Broadcast)" if v == 0 else "")))
    b = reader.read(4)
    v = bits_to_int(b)
    rows.append(make_row("REF_PROF_ID", 4, b, v,
                         "No profile info" if v == 0 else f"Profile ID = {v}"))
    b = reader.read(10)
    v = bits_to_int(b)
    rows.append(make_row("LAST_REF_RFID", 10, b,
                v, f"Last Ref RFID Tag = {v}"))
    b = reader.read(15)
    v = bits_to_signed_int(b)
    rows.append(make_row("DIST_PKT_START", 15, b, v,
                f"Packet start dist = {v} m from LAST_REF_RFID"))
    b = reader.read(2)
    v = bits_to_int(b)
    rows.append(make_row("PKT_DIR", 2, b, v,
                         {0: "Unidentified", 1: "Nominal", 2: "Reverse", 3: "Spare"}.get(v, "?")))
    b = reader.read(3)
    rows.append(make_row("Padding Bits (header)", 3, b,
                bits_to_int(b), "Header alignment padding"))

    # ── Sub-packet dispatch loop ──────────────────────────────────────────
    # Protocol layout for every sub-packet:
    #   4 bits  SUB_PKT_TYPE
    #   7 bits  SUB_PKT_LENGTH   (value N → sub-packet total = N+1 bytes,
    #                              counting the 4-bit type field as part of
    #                              the first byte, so payload bits =
    #                              (N+1)*8 - 4 - 7 = N*8 - 3)
    #   …       payload decoded by the per-type decoder
    #
    # CRITICAL: we create a BOUNDED sub-reader for each sub-packet so that
    # the per-type decoder can NEVER consume bits belonging to the next
    # sub-packet, even if it has an internal parsing error.  Any unused bits
    # inside the window are silently dropped before the next iteration.
    # This is the fix for the duplicate-sub-packet bug: previously decoders
    # read their own length field and then just kept reading from the shared
    # reader with no boundary, so variable-length optional fields (TRN_LEN,
    # REQ_SHORTEN_MA, etc.) could leave the reader mis-aligned and the next
    # 4-bit peek would land on data bits that happened to look like a valid
    # SUB_PKT_TYPE.
    seen_sub_types: set = set()
    sub_count = 0
    # CRITICAL: reserve the trailing 64 bits (LOCO_Specific_MAC_CODE + PKT_CRC,
    # C.4.2 "End of the sub packets" / "End of the packet") before deciding
    # whether more sub-packets remain. Without this, once only the 64-bit
    # MAC+CRC trailer is left, the loop still peeked its first 4 bits as a
    # candidate SUB_PKT_TYPE and its next 7 bits as a bogus SUB_PKT_LENGTH,
    # occasionally matching an unseen type (e.g. TAG_LINKING/0101) and then
    # decoding garbage — producing the runaway field counts (e.g. "103
    # fields" under TAG LINKING INFORMATION) and CRC FAIL seen in the UI,
    # because LOCO_Specific_MAC_CODE/PKT_CRC were then read from the wrong
    # bit offset. Stopping the loop once <=64 bits remain guarantees the
    # trailer is always read from its correct, fixed position.
    while reader.remaining > 64 and sub_count < 8:   # max 8 unique sub-pkt types
        sp_type_val = bits_to_int(reader.peek(4))

        # If we have already decoded this sub-packet type, we have drifted
        # past the real sub-packets into the MAC/CRC region — stop now.
        if sp_type_val in seen_sub_types:
            break

        # Consume the 4-bit type tag
        reader.read(4)

        # Read the 7-bit length field — always present for all sub-packet types
        length_bits = reader.read(7)
        length_val  = bits_to_int(length_bits)          # value N
        # Payload bits = (N+1)*8 minus the 4+7 = 11 bits already consumed
        payload_bits = (length_val + 1) * 8 - 11
        sp_name = SUB_PKT_TYPE_MAP.get(sp_type_val, f"Unknown ({sp_type_val})")

        rows.append(make_row("SUB_PKT_TYPE", 4,
                    f"{sp_type_val:04b}", sp_type_val, sp_name))

        # Emit the length field as a visible row (decoder no longer reads it)
        length_label = {
            0b0000: "SUB_PKT_LENGTH_MA",
            0b0001: "SUB_PKT_LENGTH_SSP",
            0b0010: "SUB_PKT_LENGTH_GRAD",
            0b0011: "SUB_PKT_LENGTH_LC",
            0b0100: "SUB_PKT_LENGTH_TSP",
            0b0101: "SUB_PKT_LENGTH_TLI",
            0b0110: "SUB_PKT_LENGTH_TC",
            0b0111: "SUB_PKT_LENGTH_TSR",
        }.get(sp_type_val, "SUB_PKT_LENGTH")
        rows.append(make_row(length_label, 7, length_bits, length_val,
                    f"Sub-packet length = {length_val + 1} bytes"))

        # Never let a (possibly corrupt) declared sub-packet length eat into
        # the mandatory 64-bit MAC_CODE + PKT_CRC trailer that always follows
        # the last sub-packet.
        safe_remaining = max(0, reader.remaining - 64)

        if sp_type_val not in SUB_PKT_DECODER_MAP:
            # Unknown type — skip the entire declared payload safely
            if payload_bits > 0 and safe_remaining >= payload_bits:
                reader.read(payload_bits)
            elif payload_bits > 0:
                reader.read(safe_remaining)  # consume whatever is safely left
            sub_count += 1
            continue

        # Build a bounded sub-reader with exactly payload_bits
        available = min(payload_bits, safe_remaining)
        sub_bits  = reader.read(available)
        # Zero-pad if the declared payload is longer than what remains
        if available < payload_bits:
            sub_bits += '0' * (payload_bits - available)
        sub_reader = BitReader(sub_bits)

        # Decode into the bounded reader
        rows += SUB_PKT_DECODER_MAP[sp_type_val](sub_reader)

        # Drop any unread padding bits inside this sub-packet window
        # (sub_reader automatically exhausts; we don't need to do anything)

        seen_sub_types.add(sp_type_val)
        sub_count += 1

    # After the loop above, exactly 64 bits (MAC_CODE + PKT_CRC) should
    # remain. Read them unconditionally when possible; fall back gracefully
    # for malformed/short payloads.
    if reader.remaining >= 32:
        b = reader.read(32)
        v = bits_to_int(b)
        rows.append(make_row("LOCO_Specific_MAC_CODE",
                    32, b, v, f"MAC = 0x{v:08X}"))
    if reader.remaining >= 32:
        b = reader.read(32)
        v = bits_to_int(b)
        rows.append(make_row("PKT_CRC", 32, b, v, f"Packet CRC = 0x{v:08X}"))
    return rows


# ── C.4.3  Onboard to Station Regular Packet  (PKT_TYPE = 0b1010) ──

def decode_onboard_to_station(reader):
    rows = []
    b = reader.read(7)
    v = bits_to_int(b)
    rows.append(make_row("PKT_LENGTH", 7, b, v,
                f"Packet Length = {v+1} bytes"))
    b = reader.read(17)
    v = bits_to_int(b)
    rows.append(make_row("FRAME_NUM", 17, b, v,
                f"Frame Number = {v}  →  {frame_num_to_time(v)}"))
    b = reader.read(20)
    v = bits_to_int(b)
    rows.append(make_row("SOURCE_LOCO_ID", 20, b, v,
                         f"Loco ID = {v}" + (" (Valid)" if 1 <= v <= 999999 else " (Invalid)")))
    b = reader.read(3)
    v = bits_to_int(b)
    rows.append(make_row("SOURCE_LOCO_VERSION", 3, b, v,
                KAVACH_VERSION_MAP.get(v, f"Reserved ({v})")))
    b = reader.read(23)
    v = bits_to_int(b)
    rows.append(make_row("ABS_LOCO_LOC", 23, b, v,
                         "Invalid Location" if v == 8388607 else f"Absolute Location = {v} m"))
    b = reader.read(9)
    v = bits_to_int(b)
    rows.append(make_row("L_DOUBTOVER", 9, b, v,
                f"Over-reading uncertainty = {v} m"))
    b = reader.read(9)
    v = bits_to_int(b)
    rows.append(make_row("L_DOUBTUNDER", 9, b, v,
                f"Under-reading uncertainty = {v} m"))
    b = reader.read(2)
    v = bits_to_int(b)
    rows.append(make_row("TRAIN_INT", 2, b, v,
                TRAIN_INT_MAP.get(v, "Reserved")))
    b = reader.read(11)
    v = bits_to_int(b)
    rows.append(make_row("TRAIN_LENGTH", 11, b, v,
                         "Unidentified" if v == 0 else f"Train Length = {v} m"))
    b = reader.read(9)
    v = bits_to_int(b)
    rows.append(make_row("TRAIN_SPEED", 9, b, v,
                         f"Train Speed = {v} kmph" if v <= 400 else "Reserved" if v <= 510 else "Speed unidentified"))
    b = reader.read(2)
    v = bits_to_int(b)
    rows.append(make_row("MOVEMENT_DIR", 2, b, v,
                MOVEMENT_DIR_MAP.get(v, "Reserved")))
    b = reader.read(3)
    v = bits_to_int(b)
    rows.append(make_row("EMERGENCY_STATUS", 3, b, v,
                EMERGENCY_STATUS_MAP.get(v, "Unknown")))
    b = reader.read(4)
    v = bits_to_int(b)
    rows.append(make_row("LOCO_MODE", 4, b, v,
                LOCO_MODE_MAP.get(v, f"Unknown ({v})")))
    b = reader.read(10)
    v = bits_to_int(b)
    rows.append(make_row("LAST_RFID_TAG", 10, b, v, f"Last RFID Tag ID = {v}"))
    b = reader.read(1)
    v = bits_to_int(b)
    rows.append(make_row("TAG_DUP", 1, b, v,
                "Duplicate Tag" if v else "Main Tag"))
    b = reader.read(3)
    v = bits_to_int(b)
    rows.append(make_row("TAG_LINK_INFO", 3, b, v,
                TAG_LINK_INFO_MAP.get(v, "Unknown")))
    b = reader.read(9)
    v = bits_to_int(b)
    rows.append(make_row("TIN", 9, b, v, tin_desc(v)))
    b = reader.read(3)
    v = bits_to_int(b)
    rows.append(make_row("Brake_Applied", 3, b, v,
                BRAKE_APPLIED_MAP.get(v, f"Spare ({v})")))
    b = reader.read(2)
    v = bits_to_int(b)
    rows.append(make_row("NEW_MA_REPLY", 2, b, v,
                         {0: "No shortening", 1: "MA shortening granted", 2: "MA shortening rejected", 3: "Reserved"}.get(v, "?")))
    b = reader.read(4)
    v = bits_to_int(b)
    rows.append(make_row("LAST_REF_PROFILE_NUM", 4, b, v,
                         "No track profile" if v == 0 else f"Last received profile number = {v}"))
    b = reader.read(1)
    v = bits_to_int(b)
    rows.append(make_row("SIG_OV", 1, b, v,
                "Signal Override Active" if v else "Signal Override Inactive"))
    b = reader.read(4)
    v = bits_to_int(b)
    rows.append(make_row("Info_Ack", 4, b, v,
                INFO_ACK_MAP.get(v, f"Unknown ({v})")))
    b = reader.read(2)
    v = bits_to_int(b)
    rows.append(make_row("Spare", 2, b, v, "Future use"))
    b = reader.read(6)
    v = bits_to_int(b)
    rows.append(make_row("Loco_Health_Status", 6, b, v,
                f"Health bits = 0b{v:06b} (NMS logging)"))
    if reader.remaining >= 64:
        b = reader.read(32)
        v = bits_to_int(b)
        rows.append(make_row("MAC_CODE", 32, b, v, f"MAC = 0x{v:08X}"))
    if reader.remaining >= 32:
        b = reader.read(32)
        v = bits_to_int(b)
        rows.append(make_row("PKT_CRC", 32, b, v, f"Packet CRC = 0x{v:08X}"))
    return rows


# ── C.4.4  Access Authority Packet  (PKT_TYPE = 0b1011) ──

def decode_access_authority(reader):
    rows = []
    b = reader.read(7)
    v = bits_to_int(b)
    rows.append(make_row("PKT_LENGTH", 7, b, v,
                f"Packet Length = {v+1} bytes"))
    b = reader.read(17)
    v = bits_to_int(b)
    rows.append(make_row("FRAME_NUM", 17, b, v,
                f"Frame Number = {v}  →  {frame_num_to_time(v)}"))
    b = reader.read(16)
    v = bits_to_int(b)
    rows.append(make_row("SOURCE_STN_ILC_IBS_ID", 16,
                b, v, f"Station/ILC/IBS ID = {v}"))
    b = reader.read(3)
    v = bits_to_int(b)
    rows.append(make_row("SOURCE_STN_ILC_IBS_VERSION", 3, b, v,
                KAVACH_VERSION_MAP.get(v, f"Reserved ({v})")))
    b = reader.read(23)
    v = bits_to_int(b)
    rows.append(make_row("STN_ILC_IBS_LOC", 23, b, v,
                f"Station Absolute Location = {v} m"))
    b = reader.read(20)
    v = bits_to_int(b)
    rows.append(make_row("DEST_LOCO_ID", 20, b,
                v, f"Destination Loco ID = {v}"))

    def freq_desc(v, label):
        if v == 0:
            return f"{label} FDMA Not Used"
        if 1 <= v <= 2560:
            return f"{label} Channel {v} = {406 + v * 0.025:.3f} MHz"
        if v == 4094:
            return f"{label} Other system (WiFi/LTE/4G/5G)"
        return "Reserved / Not to be used"

    b = reader.read(12)
    v = bits_to_int(b)
    rows.append(make_row("Allotted_UpLink_Freq",
                12, b, v, freq_desc(v, "Uplink")))
    b = reader.read(12)
    v = bits_to_int(b)
    rows.append(make_row("Allotted_DownLink_Freq",
                12, b, v, freq_desc(v, "Downlink")))
    b = reader.read(7)
    v = bits_to_int(b)
    rows.append(make_row("Allotted_TDMA_Timeslot", 7, b, v,
                         "Not nominated" if v == 0 else f"TDMA time slot = {v}"))
    b = reader.read(16)
    v = bits_to_int(b)
    rows.append(make_row("STN_RND_NUM_RS", 16, b, v,
                f"Station Random Number = {v} (session response)"))
    b = reader.read(7)
    v = bits_to_int(b)
    rows.append(make_row("STN_TDMA", 7, b, v,
                         "Not used" if v == 127 else f"Station TDMA slot = {v}"))
    if reader.remaining >= 64:
        b = reader.read(32)
        v = bits_to_int(b)
        rows.append(make_row("MAC_CODE", 32, b, v, f"MAC = 0x{v:08X}"))
    if reader.remaining >= 32:
        b = reader.read(32)
        v = bits_to_int(b)
        rows.append(make_row("PKT_CRC", 32, b, v, f"Packet CRC = 0x{v:08X}"))
    return rows


# ── C.4.5  Additional Emergency Packet  (PKT_TYPE = 0b1100) ──

def decode_additional_emergency(reader):
    rows = []
    b = reader.read(7)
    v = bits_to_int(b)
    rows.append(make_row("PKT_LENGTH", 7, b, v,
                f"Packet Length = {v+1} bytes"))
    b = reader.read(17)
    v = bits_to_int(b)
    rows.append(make_row("FRAME_NUM", 17, b, v,
                f"Frame Number = {v}  →  {frame_num_to_time(v)}"))
    b = reader.read(16)
    v = bits_to_int(b)
    rows.append(make_row("SOURCE_STN_ILC_IBS_ID", 16,
                b, v, f"Station/ILC/IBS ID = {v}"))
    b = reader.read(3)
    v = bits_to_int(b)
    rows.append(make_row("SOURCE_STN_ILC_IBS_VERSION", 3, b, v,
                KAVACH_VERSION_MAP.get(v, f"Reserved ({v})")))
    b = reader.read(23)
    v = bits_to_int(b)
    rows.append(make_row("STN_ILC_IBS_LOC", 23, b, v,
                f"Station Absolute Location = {v} m"))
    b = reader.read(1)
    v = bits_to_int(b)
    rows.append(make_row("GEN_SOS_CALL", 1, b, v,
                         "General SoS Call – manual SOS button pressed" if v else "No Station Manual SoS"))
    b = reader.read(1)
    rows.append(make_row("Padding bits", 1, b,
                bits_to_int(b), "Byte alignment padding"))
    if reader.remaining >= 32:
        b = reader.read(32)
        v = bits_to_int(b)
        rows.append(make_row("PKT_CRC", 32, b, v, f"Packet CRC = 0x{v:08X}"))
    return rows


# ── C.4.6  Onboard Access Request Packet  (PKT_TYPE = 0b1101) ──

def decode_access_request(reader):
    rows = []
    b = reader.read(7)
    v = bits_to_int(b)
    rows.append(make_row("PKT_LENGTH", 7, b, v,
                f"Packet Length = {v+1} bytes"))
    b = reader.read(17)
    v = bits_to_int(b)
    rows.append(make_row("FRAME_NUM", 17, b, v,
                f"Frame Number = {v}  →  {frame_num_to_time(v)}"))
    b = reader.read(20)
    v = bits_to_int(b)
    rows.append(make_row("SOURCE_LOCO_ID", 20, b, v,
                         f"Loco ID = {v}" + (" (Valid)" if 1 <= v <= 999999 else " (Invalid)")))
    b = reader.read(3)
    v = bits_to_int(b)
    rows.append(make_row("SOURCE_LOCO_VERSION", 3, b, v,
                KAVACH_VERSION_MAP.get(v, f"Reserved ({v})")))
    b = reader.read(23)
    v = bits_to_int(b)
    rows.append(make_row("ABS_LOCO_LOC", 23, b, v,
                         "Invalid Location" if v == 8388607 else f"Absolute Location = {v} m"))
    b = reader.read(11)
    v = bits_to_int(b)
    rows.append(make_row("TRAIN_LENGTH", 11, b, v,
                         "Unidentified/Invalid" if v == 0 else f"Train Length = {v} m"))
    b = reader.read(9)
    v = bits_to_int(b)
    rows.append(make_row("TRAIN_SPEED", 9, b, v,
                         f"Train Speed = {v} kmph" if v <= 400 else "Reserved" if v <= 510 else "Speed unidentified"))
    b = reader.read(2)
    v = bits_to_int(b)
    rows.append(make_row("MOVEMENT_DIR", 2, b, v,
                MOVEMENT_DIR_MAP.get(v, "Reserved")))
    b = reader.read(3)
    v = bits_to_int(b)
    rows.append(make_row("EMERGENCY_STATUS", 3, b, v,
                EMERGENCY_STATUS_MAP.get(v, "Unknown")))
    b = reader.read(4)
    v = bits_to_int(b)
    rows.append(make_row("LOCO_MODE", 4, b, v,
                LOCO_MODE_MAP.get(v, f"Unknown ({v})")))
    b = reader.read(16)
    v = bits_to_int(b)
    rows.append(make_row("Approaching Station ID", 16,
                b, v, f"Approaching Station ID = {v}"))
    b = reader.read(10)
    v = bits_to_int(b)
    rows.append(make_row("LAST_RFID_TAG", 10, b, v, f"Last RFID Tag ID = {v}"))
    b = reader.read(9)
    v = bits_to_int(b)
    rows.append(make_row("TIN", 9, b, v, tin_desc(v)))
    b = reader.read(21)
    raw = bits_to_int(b)
    lon_deg = raw >> 12
    lon_min = (raw >> 6) & 0x3F
    lon_sec = raw & 0x3F
    rows.append(make_row("Longitude", 21, b, raw,
                f"Longitude: {lon_deg}\u00b0 {lon_min}' {lon_sec}\""))
    b = reader.read(20)
    raw = bits_to_int(b)
    lat_deg = raw >> 12
    lat_min = (raw >> 6) & 0x3F
    lat_sec = raw & 0x3F
    rows.append(make_row("Latitude", 20, b, raw,
                f"Latitude: {lat_deg}\u00b0 {lat_min}' {lat_sec}\""))
    b = reader.read(16)
    v = bits_to_int(b)
    rows.append(make_row("LOCO_RND_NUM_RL", 16, b, v,
                f"Onboard Random Number = {v} (session request)"))
    if reader.remaining >= 5:
        b = reader.read(5)
        rows.append(make_row("Padding bits", 5, b,
                    bits_to_int(b), "Byte alignment padding"))
    if reader.remaining >= 32:
        b = reader.read(32)
        v = bits_to_int(b)
        rows.append(make_row("PKT_CRC", 32, b, v, f"Packet CRC = 0x{v:08X}"))
    return rows


# ── Router ──────────────────────────────────────────────────────────

PACKET_DECODER_MAP = {
    0b1001: decode_station_to_onboard,
    0b1010: decode_onboard_to_station,
    0b1011: decode_access_authority,
    0b1100: decode_additional_emergency,
    0b1101: decode_access_request,
}


def decode_packet(pkt_type_val, remaining_bits, active_radio):
    reader = BitReader(remaining_bits)
    pkt_type_name = PKT_TYPE_MAP.get(
        pkt_type_val, f"Unknown (0b{pkt_type_val:04b})")
    result = {"packet_type_value": pkt_type_val, "packet_type_name": pkt_type_name,
              "active_radio": active_radio, "fields": []}
    decoder = PACKET_DECODER_MAP.get(pkt_type_val)
    if decoder:
        result["fields"] = decoder(reader)
    else:
        result["fields"] = [make_row("INFO", "-",
                                     remaining_bits[:64] +
                                     ("..." if len(remaining_bits)
                                      > 64 else ""), "-",
                                     f"No decoder for PKT_TYPE={pkt_type_val} ({pkt_type_name})")]
    return result


def decode_radio_packet(packet):
    active_radio = packet.get("activeRadio", "Unknown")
    payload_hex = packet.get("messagePayload", "").strip()
    if not payload_hex:
        return {"error": "Empty messagePayload", "fields": []}
    try:
        all_bits = hex_to_bits(payload_hex)
    except Exception as e:
        return {"error": f"Invalid hex payload: {e}", "fields": []}

    reader = BitReader(all_bits)
    if reader.remaining < 4:
        return {"error": "Payload too short (< 4 bits)", "fields": []}

    pkt_type_bits = reader.read(4)
    pkt_type_val = bits_to_int(pkt_type_bits)
    remaining = reader.bits[reader.pos:]

    decoded = decode_packet(pkt_type_val, remaining, active_radio)
    decoded.update({"payload_hex": payload_hex, "total_bits": len(all_bits),
                    "pkt_type_bits": pkt_type_bits})
    decoded["fields"].insert(0, make_row(
        "PKT_TYPE", 4, pkt_type_bits, pkt_type_val, decoded["packet_type_name"]))

    # ── CRC-32 verification ──────────────────────────────────────────────────
    # CRC covers all packet bytes except the last 4 (the PKT_CRC field itself).
    crc_result = verify_packet_crc(payload_hex)
    decoded["crc_check"] = crc_result

    # Annotate the PKT_CRC row in the field list with the verification result
    for row in decoded["fields"]:
        if row.get("Field") == "PKT_CRC":
            status = "✓ PASS" if crc_result.get("match") else "✗ FAIL"
            row["Description"] = (
                f"Packet CRC = {crc_result.get('stored_hex', '?')} "
                f"| Computed = {crc_result.get('computed_hex', '?')} | {status}"
            )
            break

    return decoded


def decode_all_packets(packets):
    if isinstance(packets, dict):
        packets = [packets]
    results = []
    for i, pkt in enumerate(packets):
        r = decode_radio_packet(pkt)
        r["packet_index"] = i + 1
        results.append(r)
    return results