import { useState, useRef, useEffect, useCallback, useMemo } from "react";

import { API_BASE } from "./apiBase";
import { UserChip } from "./Auth";
import LogReplay from "./LogReplay";
import DmiSim from "./DmiSim";
const INGEST_URL = API_BASE + "/ingest";
const HEALTH_URL = API_BASE + "/health";

/* ── Bit injection ── */
function injectBits(hex, start, len, val) {
  const bits = hex.split("").flatMap(c => parseInt(c,16).toString(2).padStart(4,"0").split("").map(Number));
  val.toString(2).padStart(len,"0").split("").forEach((b,i) => { if (start+i < bits.length) bits[start+i]=Number(b); });
  while (bits.length%8) bits.push(0);
  return Array.from({length:bits.length/8},(_,i)=>parseInt(bits.slice(i*8,i*8+8).join(""),2).toString(16).toUpperCase().padStart(2,"0")).join("");
}

/* ── Severity palette ── */
const S = {
  critical:{ c:"#f43f5e", bg:"rgba(244,63,94,0.13)",  ring:"rgba(244,63,94,0.35)",  label:"CRITICAL", icon:"🔴" },
  high:    { c:"#fb923c", bg:"rgba(251,146,60,0.13)",  ring:"rgba(251,146,60,0.35)", label:"HIGH",     icon:"🟠" },
  medium:  { c:"#60a5fa", bg:"rgba(96,165,250,0.13)",  ring:"rgba(96,165,250,0.35)", label:"MEDIUM",   icon:"🔵" },
  info:    { c:"#a78bfa", bg:"rgba(167,139,250,0.13)", ring:"rgba(167,139,250,0.35)",label:"INFO",     icon:"🟣" },
};

const PACKETS = [
  {
    id:"c46", label:"C.4.6", abbr:"AccReq",
    name:"Access Request",
    route:"Loco → Station", pktType:"0b1101 (13)",
    color:"#f59e0b",
    radio:"0xF1",
    base:"D3900C103039407CFA80C8C9040413501800000000000000006B293B76",
    note: null,
    testFields:[
      { cat:"sos", fieldName:"EMERGENCY_STATUS", label:"Emergency Status",
        bitStart:96, bitLen:3,
        options:[
          {val:0,text:"No Emergency",                         sev:null,       tag:null},
          {val:1,text:"Unusual Stoppage / Side Collision",    sev:"critical", tag:"SOS"},
          {val:2,text:"SoS",                                  sev:"critical", tag:"SOS"},
          {val:3,text:"Roll Back Detected",                   sev:"high",     tag:"SOS"},
          {val:4,text:"Head On Collision",                    sev:"critical", tag:"SOS"},
          {val:5,text:"Rear End Collision",                   sev:"critical", tag:"SOS"},
          {val:6,text:"Parting SoS",                          sev:"high",     tag:"SOS"},
          {val:7,text:"Spare",                                sev:null,       tag:null},
        ]},
      { cat:"mode", fieldName:"LOCO_MODE", label:"Loco Operating Mode",
        bitStart:99, bitLen:4,
        options:[
          {val:1,  text:"Stand_By",              sev:null,   tag:null},
          {val:2,  text:"Staff_Responsible",     sev:"info", tag:"MODE"},
          {val:3,  text:"Limited_Supervision",   sev:"info", tag:"MODE"},
          {val:4,  text:"Full_Supervision",      sev:null,   tag:null},
          {val:5,  text:"Override",              sev:"high", tag:"MODE"},
          {val:6,  text:"On_Sight",              sev:"info", tag:"MODE"},
          {val:7,  text:"Trip",                  sev:"critical",tag:"MODE"},
          {val:8,  text:"Post_Trip",             sev:"high", tag:"MODE"},
          {val:9,  text:"Reverse",               sev:"info", tag:"MODE"},
          {val:10, text:"Shunting",              sev:"info", tag:"MODE"},
          {val:11, text:"Non_Leading",           sev:"info", tag:"MODE"},
          {val:12, text:"System_Failure",        sev:"critical",tag:"MODE"},
          {val:13, text:"Isolation",             sev:"critical",tag:"MODE"},
        ]},
      { cat:"speed", fieldName:"TRAIN_SPEED", label:"Reported Train Speed",
        bitStart:85, bitLen:9,
        note:"Value = actual kmph. Range 0–400 valid.",
        presets:[
          {val:0,   text:"0 kmph — Stationary"},
          {val:30,  text:"30 kmph — Slow"},
          {val:75,  text:"75 kmph — Normal"},
          {val:110, text:"110 kmph — High speed"},
          {val:160, text:"160 kmph — Over-speed (triggers brake)"},
          {val:400, text:"400 kmph — Maximum valid"},
          {val:511, text:"511 — Speed unidentified"},
        ]},
      { cat:"dir", fieldName:"MOVEMENT_DIR", label:"Movement Direction",
        bitStart:94, bitLen:2,
        options:[
          {val:0,text:"Unidentified",          sev:null,   tag:null},
          {val:1,text:"Nominal (DOWN direction)",sev:null, tag:null},
          {val:2,text:"Reverse (UP direction)",sev:"info", tag:"DIR"},
          {val:3,text:"Reserved",              sev:null,   tag:null},
        ]},
    ],
  },
  {
    id:"c43", label:"C.4.3", abbr:"L2S Reg",
    name:"Loco to Station Regular",
    route:"Loco → Station", pktType:"0b1010 (10)",
    color:"#10b981",
    radio:"0xF1",
    base:"A38A479001F841008D8000000C80104B981F40000011AD67DD2E14CF7A",
    note: null,
    testFields:[
      { cat:"sos", fieldName:"EMERGENCY_STATUS", label:"Emergency Status",
        bitStart:116, bitLen:3,
        options:[
          {val:0,text:"No Emergency",                         sev:null,       tag:null},
          {val:1,text:"Unusual Stoppage / Side Collision",    sev:"critical", tag:"SOS"},
          {val:2,text:"SoS",                                  sev:"critical", tag:"SOS"},
          {val:3,text:"Roll Back Detected",                   sev:"high",     tag:"SOS"},
          {val:4,text:"Head On Collision",                    sev:"critical", tag:"SOS"},
          {val:5,text:"Rear End Collision",                   sev:"critical", tag:"SOS"},
          {val:6,text:"Parting SoS",                          sev:"high",     tag:"SOS"},
          {val:7,text:"Spare",                                sev:null,       tag:null},
        ]},
      { cat:"brake", fieldName:"Brake_Applied", label:"Brake Applied (Kavach)",
        bitStart:146, bitLen:3,
        options:[
          {val:0,text:"No over speed, No brakes",            sev:null,       tag:null},
          {val:1,text:"Over speed — no brakes yet",          sev:"high",     tag:"BRAKE"},
          {val:2,text:"Normal Service Brake by Kavach",      sev:"high",     tag:"BRAKE"},
          {val:3,text:"Full Service Brake by Kavach",        sev:"high",     tag:"BRAKE"},
          {val:4,text:"Emergency Brake by Kavach",           sev:"critical", tag:"BRAKE"},
        ]},
      { cat:"mode", fieldName:"LOCO_MODE", label:"Loco Operating Mode",
        bitStart:119, bitLen:4,
        options:[
          {val:1, text:"Stand_By",             sev:null,       tag:null},
          {val:2, text:"Staff_Responsible",    sev:"info",     tag:"MODE"},
          {val:3, text:"Limited_Supervision",  sev:"info",     tag:"MODE"},
          {val:4, text:"Full_Supervision",     sev:null,       tag:null},
          {val:5, text:"Override",             sev:"high",     tag:"MODE"},
          {val:6, text:"On_Sight",             sev:"info",     tag:"MODE"},
          {val:7, text:"Trip",                 sev:"critical", tag:"MODE"},
          {val:8, text:"Post_Trip",            sev:"high",     tag:"MODE"},
          {val:9, text:"Reverse",              sev:"info",     tag:"MODE"},
          {val:10,text:"Shunting",             sev:"info",     tag:"MODE"},
          {val:11,text:"Non_Leading",          sev:"info",     tag:"MODE"},
          {val:12,text:"System_Failure",       sev:"critical", tag:"MODE"},
          {val:13,text:"Isolation",            sev:"critical", tag:"MODE"},
        ]},
      { cat:"speed", fieldName:"TRAIN_SPEED", label:"Reported Train Speed",
        bitStart:105, bitLen:9,
        note:"Value = actual kmph. 0=stationary, 511=unidentified.",
        presets:[
          {val:0,   text:"0 kmph — Stationary"},
          {val:30,  text:"30 kmph — Slow"},
          {val:75,  text:"75 kmph — Normal"},
          {val:110, text:"110 kmph — High speed"},
          {val:160, text:"160 kmph — Potential over-speed"},
          {val:400, text:"400 kmph — Maximum valid"},
          {val:511, text:"511 — Speed unidentified"},
        ]},
      { cat:"dir", fieldName:"MOVEMENT_DIR", label:"Movement Direction",
        bitStart:114, bitLen:2,
        options:[
          {val:0,text:"Unidentified",           sev:null,  tag:null},
          {val:1,text:"Nominal (DOWN direction)", sev:null,  tag:null},
          {val:2,text:"Reverse (UP direction)",   sev:"info",tag:"DIR"},
          {val:3,text:"Reserved",               sev:null,  tag:null},
        ]},
      { cat:"dir", fieldName:"TRAIN_INT", label:"Train Integrity",
        bitStart:92, bitLen:2,
        options:[
          {val:0,text:"No integrity info",                    sev:"high",  tag:"INTG"},
          {val:1,text:"Confirmed by integrity monitoring",    sev:null,    tag:null},
          {val:2,text:"Confirmed by Loco Pilot",             sev:null,    tag:null},
          {val:3,text:"Reserved",                            sev:null,    tag:null},
        ]},
      { cat:"signal", fieldName:"SIG_OV", label:"Signal Override",
        bitStart:155, bitLen:1,
        options:[
          {val:0,text:"Signal Override Inactive",   sev:null,   tag:null},
          {val:1,text:"Signal Override ACTIVE",     sev:"high", tag:"SIGOV"},
        ]},
      { cat:"ack", fieldName:"Info_Ack", label:"Information Acknowledgement",
        bitStart:156, bitLen:4,
        options:[
          {val:0, text:"No Ack",                      sev:null,   tag:null},
          {val:1, text:"Loco Specific SoS Ack by LP", sev:"info", tag:"ACK"},
          {val:2, text:"FS to LS Ack by LP",          sev:"info", tag:"ACK"},
          {val:3, text:"LS to SR Ack by LP",          sev:"info", tag:"ACK"},
          {val:4, text:"FS to SR Ack by LP",          sev:"info", tag:"ACK"},
          {val:5, text:"OS to SR Ack by LP",          sev:"info", tag:"ACK"},
          {val:6, text:"OV to SR Ack by LP",          sev:"info", tag:"ACK"},
          {val:7, text:"Trip Ack by LP",              sev:"high", tag:"ACK"},
          {val:8, text:"PTRIP to SR Ack by LP",       sev:"high", tag:"ACK"},
          {val:9, text:"Auto horn Ack by LP",         sev:"info", tag:"ACK"},
          {val:12,text:"Unusual Stoppage Ack by LP",  sev:"high", tag:"ACK"},
          {val:13,text:"Manual SoS Ack by LP",        sev:"critical",tag:"ACK"},
        ]},
    ],
  },
  {
    id:"c42", label:"C.4.2", abbr:"S2L Reg",
    name:"Station to Loco Regular",
    route:"Station → Loco", pktType:"0b1001 (9)",
    color:"#06b6d4",
    radio:"0xF1",
    base:"92ED5BEE035E8007D0D69084C8016204E88422C15B230254001081B98A6025D1138948320802EE100AF200FA048258804E20607D01471808578200324001909044D000320C09F8206E01049C1830C107061301805BE0F8005D8191770C95E0AECEF3E83C0FA0F13E83C8FA0F33E83D0FA0F53E83D8FA0F73E83E0FA0F93E83E8FA0FB3E83F0FA0FD3E83F8FA0FF3E8404FA1023E89643215F12C580FA1610C8588CCD630C8590CF9650C85999C4003EFF82D26982D995C2DE3A02B8E",
    note: null,
    testFields:[
      { cat:"sos", fieldName:"DEST_LOCO_SOS", label:"Destination Loco SoS",
        bitStart:119, bitLen:4,
        options:[
          {val:0,text:"No SoS / Emergency",                          sev:null,       tag:null},
          {val:1,text:"Foreign RFID",                                sev:"medium",   tag:"SOS"},
          {val:2,text:"Reserved",                                    sev:null,       tag:null},
          {val:3,text:"Onboard Odo error >= 120 m",                 sev:"medium",   tag:"SOS"},
          {val:4,text:"Detection of SPAD",                           sev:"critical", tag:"SOS"},
          {val:5,text:"Rear-end collision",                          sev:"critical", tag:"SOS"},
          {val:6,text:"Head-On collision",                           sev:"critical", tag:"SOS"},
          {val:7,text:"Violation of Shunting limits (shunt mode)",   sev:"high",     tag:"SOS"},
          {val:8,text:"Station General SoS",                         sev:"critical", tag:"SOS"},
        ]},
      { cat:"signal", fieldName:"CUR_SIG_ASPECT", label:"Current Signal Aspect",
        bitStart:142, bitLen:6,
        options:[
          {val:1, text:"Red",                    sev:"critical", tag:"SIG"},
          {val:2, text:"Yellow",                 sev:"high",     tag:"SIG"},
          {val:10,text:"Double Yellow",           sev:"high",     tag:"SIG"},
          {val:11,text:"Green",                  sev:null,       tag:null},
          {val:14,text:"AG Marker OFF",          sev:"high",     tag:"SIG"},
          {val:15,text:"Red + Calling-On",       sev:"critical", tag:"SIG"},
          {val:48,text:"Stop Board / Buffer Stop",sev:"critical", tag:"SIG"},
        ]},
      { cat:"signal", fieldName:"NEXT_SIG_ASPECT", label:"Next Signal Aspect",
        bitStart:148, bitLen:6,
        options:[
          {val:0, text:"Undefined (current=RED)",sev:"critical", tag:"SIG"},
          {val:1, text:"Red",                    sev:"critical", tag:"SIG"},
          {val:2, text:"Yellow",                 sev:"high",     tag:"SIG"},
          {val:10,text:"Double Yellow",           sev:"high",     tag:"SIG"},
          {val:11,text:"Green",                  sev:null,       tag:null},
          {val:14,text:"AG Marker OFF",          sev:"high",     tag:"SIG"},
          {val:15,text:"Red + Calling-On",       sev:"critical", tag:"SIG"},
        ]},
      { cat:"signal", fieldName:"AUTHORITY_TYPE", label:"Movement Authority Type",
        bitStart:169, bitLen:2,
        options:[
          {val:0,text:"Not to be used",                          sev:"critical", tag:"AUTH"},
          {val:1,text:"OS Authority (On-Sight mode)",            sev:"info",     tag:"AUTH"},
          {val:2,text:"FS Authority (Full Supervision)",         sev:null,       tag:null},
          {val:3,text:"SR Authority (Staff Responsible)",        sev:"high",     tag:"AUTH"},
        ]},
      { cat:"speed", fieldName:"AUTHORIZED_SPEED", label:"Authorized Speed",
        bitStart:171, bitLen:6,
        note:"Value N = N×5 kmph. 1→5kmph, 10→50kmph, 20→100kmph, 30→150kmph.",
        presets:[
          {val:0, text:"0 — Reserved"},
          {val:5, text:"25 kmph — Restricted"},
          {val:10,text:"50 kmph — Caution"},
          {val:15,text:"75 kmph — Normal"},
          {val:20,text:"100 kmph — Fast"},
          {val:30,text:"150 kmph — High speed"},
          {val:40,text:"200 kmph — Very high speed"},
          {val:50,text:"250 kmph — Max allowed"},
          {val:62,text:"62 — 8 kmph (auto signal override night)"},
        ]},
    ],
  },
  {
    id:"c44", label:"C.4.4", abbr:"AccAuth",
    name:"Access Authority",
    route:"Station → Loco", pktType:"0b1011 (11)",
    color:"#8b5cf6",
    radio:"0xF1",
    base:"B32D62101AF41009783FF74CECE4D03DA37EFEEB7E11D23192CE",
    note:"C.4.4 Access Authority has no SOS or testable alert fields per Annexure-C. Use SEND CLEAN to verify decoding.",
    testFields:[],
  },
  {
    id:"c45", label:"C.4.5", abbr:"Emer",
    name:"Additional Emergency",
    route:"Station → Loco", pktType:"0b1100 (12)",
    color:"#ef4444",
    radio:"0xF1",
    base:"C1880C10000001B00000000000000001D23192CE",
    isEmergency:true,
    note:"Dedicated emergency packet from station. GEN_SOS_CALL bit signals manual SOS button press — different from loco EMERGENCY_STATUS.",
    testFields:[
      { cat:"sos", fieldName:"GEN_SOS_CALL", label:"General SoS Call",
        bitStart:70, bitLen:1,
        options:[
          {val:0,text:"No Station Manual SoS",                         sev:null,       tag:null},
          {val:1,text:"Manual SOS button pressed at Station",          sev:"critical", tag:"SOS"},
        ]},
    ],
  },
];

const CATS = {
  sos:    { label:"SOS / Emergency",    icon:"🚨", color:"#f43f5e" },
  brake:  { label:"Brake Applied",      icon:"🛑", color:"#fb923c" },
  mode:   { label:"Loco Mode",          icon:"🚆", color:"#a78bfa" },
  speed:  { label:"Speed",              icon:"⚡", color:"#fbbf24" },
  signal: { label:"Signal / Authority", icon:"🚦", color:"#34d399" },
  dir:    { label:"Direction / Integrity",icon:"🧭",color:"#60a5fa" },
  ack:    { label:"Acknowledgement",    icon:"✅", color:"#94a3b8" },
};

const DK=`--void:#07070a;--base:#0c0c10;--surf:#111115;--raised:#171720;--hover:#1c1c28;--inp:#080810;--bdr:#1e1e2e;--bdr2:#2a2a3e;--bdr3:#363655;--amber:#f59e0b;--aglow:rgba(245,158,11,0.15);--green:#10b981;--cyan:#06b6d4;--red:#ef4444;--purple:#8b5cf6;--tp:#eaeaf8;--ts:#8888aa;--tm:#44445a;--td:#28283a;--tc:#84cc16;--topbg:#060609;--topbdr:#18182a;--ftbg:#08080c;--trk:#1e1e2e;--thm:#f59e0b;--alt:rgba(255,255,255,0.015);`;
const LK=`--void:#f1f1f8;--base:#f8f8fd;--surf:#ffffff;--raised:#f0f0f8;--hover:#e8e8f4;--inp:#fafafe;--bdr:#d4d4e8;--bdr2:#b8b8d0;--bdr3:#9898b8;--amber:#b45309;--aglow:rgba(180,83,9,0.1);--green:#059669;--cyan:#0284c7;--red:#dc2626;--purple:#7c3aed;--tp:#0f0f1e;--ts:#44446a;--tm:#7070a0;--td:#a0a0c0;--tc:#166534;--topbg:#1a1a30;--topbdr:#28284a;--ftbg:#f4f4fc;--trk:#d0d0e8;--thm:#1e3a8a;--alt:rgba(0,0,40,0.022);`;

const CSS=`
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{${DK}--mono:'IBM Plex Mono',monospace;--hd:'Bebas Neue',sans-serif;--body:'DM Sans',sans-serif;}
:root.light{${LK}}
html,body,#root{height:100%;width:100%;background:var(--void);color:var(--tp);font-family:var(--body);}
*{transition:background-color .2s,border-color .2s,color .15s;}
::-webkit-scrollbar{width:4px;height:4px;}::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:var(--bdr2);border-radius:2px;}::-webkit-scrollbar-thumb:hover{background:var(--amber);}
button{cursor:pointer;font-family:var(--body);}button:disabled{cursor:not-allowed;opacity:.4;}
/* NOVA company logo — same as the PINJ header (App.jsx .kv-nova-logo). The top bar is dark in both themes,
   so the light-text wordmark (nova-text-dark.png) is always used. */
.kv-nova-logo{display:flex;align-items:center;gap:10px;flex-shrink:0;height:52px;cursor:default;position:relative;}
.kv-nova-logo-markwrap{position:relative;width:44px;height:44px;flex-shrink:0;}
.kv-nova-logo-markwrap::before{content:'';position:absolute;inset:6px;border-radius:50%;pointer-events:none;
  background:radial-gradient(circle,rgba(56,189,248,0.28),rgba(168,85,247,0.12) 55%,transparent 72%);animation:kv-nova-halo 4.2s ease-in-out infinite;}
.kv-nova-logo-mark{position:relative;height:44px;width:44px;object-fit:contain;display:block;animation:kv-nova-breathe 4.2s ease-in-out infinite;transition:transform .35s cubic-bezier(0.22,1,0.36,1);}
@keyframes kv-nova-breathe{0%,100%{filter:drop-shadow(0 0 5px rgba(56,189,248,0.40)) drop-shadow(0 0 1px rgba(56,189,248,0.6));}50%{filter:drop-shadow(0 0 11px rgba(168,85,247,0.55)) drop-shadow(0 0 3px rgba(56,189,248,0.7));}}
@keyframes kv-nova-halo{0%,100%{opacity:.45;transform:scale(.92);}50%{opacity:.95;transform:scale(1.08);}}
.kv-nova-logo-wordwrap{position:relative;display:block;height:26px;}
.kv-nova-logo-word{height:26px;width:auto;object-fit:contain;display:block;filter:drop-shadow(0 0 4px rgba(226,232,240,0.18));transition:filter .35s;}
.kv-nova-logo-shine{position:absolute;inset:0;pointer-events:none;
  -webkit-mask:url(/nova-text-dark.png) center / 100% 100% no-repeat;mask:url(/nova-text-dark.png) center / 100% 100% no-repeat;
  background:linear-gradient(105deg,transparent 0%,transparent 40%,rgba(125,211,252,0.95) 48%,#ffffff 50%,rgba(192,132,252,0.9) 53%,transparent 61%,transparent 100%);
  background-size:300% 100%;background-repeat:no-repeat;animation:kv-nova-shine 5.5s ease-in-out infinite;}
@keyframes kv-nova-shine{0%,55%{background-position:120% 0;}85%,100%{background-position:-20% 0;}}
.kv-nova-logo:hover .kv-nova-logo-mark{transform:translateY(-1px) scale(1.05);}
.kv-nova-logo:hover .kv-nova-logo-word{filter:drop-shadow(0 0 7px rgba(125,211,252,0.45));}
.kv-nova-divider{width:1px;height:30px;flex-shrink:0;background:linear-gradient(180deg,transparent,rgba(56,189,248,0.45) 30%,rgba(168,85,247,0.35) 70%,transparent);}
.kv-back{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:.08em;color:#cbd5e1;font-family:var(--mono);text-decoration:none;
  padding:5px 11px;border-radius:7px;border:1px solid rgba(56,189,248,0.35);background:rgba(56,189,248,0.08);flex-shrink:0;transition:all .15s;}
.kv-back:hover{color:#fff;border-color:#38bdf8;background:rgba(56,189,248,0.18);box-shadow:0 0 12px rgba(56,189,248,0.3);}
@media (prefers-reduced-motion:reduce){.kv-nova-logo-mark,.kv-nova-logo-markwrap::before,.kv-nova-logo-shine{animation:none;}.kv-nova-logo-shine{display:none;}}
input,select,textarea{font-family:var(--mono);}
@keyframes pdot{0%,100%{opacity:1}50%{opacity:.2}}
@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes fadein{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes slidein{from{opacity:0;transform:translateX(-5px)}to{opacity:1;transform:none}}
@keyframes tspin{0%{transform:rotate(0)scale(1)}50%{transform:rotate(180deg)scale(1.3)}100%{transform:rotate(360deg)scale(1)}}
@keyframes tin{from{opacity:0;transform:translateX(115%)}to{opacity:1;transform:none}}
@keyframes tout{from{opacity:1}to{opacity:0;transform:translateX(115%)}}
@keyframes tbar{from{width:100%}to{width:0}}
@keyframes armglow{0%,100%{box-shadow:0 0 0 0 rgba(244,63,94,.45)}60%{box-shadow:0 0 0 8px rgba(244,63,94,0)}}
.fadein{animation:fadein .25s ease forwards;}
.slidein{animation:slidein .2s ease forwards;}
.dot-pulse{animation:pdot 1.2s ease-in-out infinite;}
.blink{animation:blink .8s step-end infinite;}
.tin{animation:tin .35s cubic-bezier(.34,1.56,.64,1) forwards;}
.tout{animation:tout .28s ease forwards;}
.armed{animation:armglow 1.6s ease-in-out infinite;}
.tog{position:relative;width:50px;height:25px;border-radius:12px;border:1.5px solid var(--bdr2);background:var(--trk);cursor:pointer;flex-shrink:0;transition:border-color .2s;}
.tog:hover{border-color:var(--amber);}
.tog-t{position:absolute;top:3px;left:3px;width:17px;height:17px;border-radius:50%;background:var(--thm);transition:transform .3s cubic-bezier(.34,1.56,.64,1);display:flex;align-items:center;justify-content:center;font-size:9px;}
.tog.on .tog-t{transform:translateX(25px);}
.tag{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.06em;white-space:nowrap;}
.opt-row{display:flex;align-items:center;gap:8px;padding:7px 11px;border-radius:7px;cursor:pointer;border:1px solid var(--bdr);background:var(--raised);transition:all .15s;}
.opt-row:hover{border-color:var(--bdr2);background:var(--hover);}
.opt-row.sel-critical{border-color:rgba(244,63,94,.5);background:rgba(244,63,94,.09);}
.opt-row.sel-high{border-color:rgba(251,146,60,.5);background:rgba(251,146,60,.09);}
.opt-row.sel-medium{border-color:rgba(96,165,250,.5);background:rgba(96,165,250,.09);}
.opt-row.sel-info{border-color:rgba(167,139,250,.5);background:rgba(167,139,250,.09);}
.opt-row.sel-none{border-color:var(--bdr2);background:var(--hover);}
.preset-btn{width:100%;text-align:left;padding:6px 11px;border-radius:6px;border:1px solid var(--bdr);background:var(--raised);color:var(--ts);font-family:var(--mono);font-size:10px;cursor:pointer;transition:all .14s;display:flex;align-items:center;gap:8px;}
.preset-btn:hover{border-color:var(--amber);color:var(--amber);}
.preset-btn.active-preset{border-color:var(--amber);background:rgba(245,158,11,.12);color:var(--amber);}
.cat-tab{padding:4px 10px;border-radius:5px;border:1px solid var(--bdr);background:transparent;font-family:var(--mono);font-size:9px;font-weight:700;cursor:pointer;transition:all .14s;color:var(--tm);letter-spacing:.04em;white-space:nowrap;}
.cat-tab:hover{border-color:var(--bdr2);color:var(--ts);}
`;

/* ── Toast ── */
function Toast({t,onX}){
  const sv=S[t.sev]||S.critical;
  const isBrake=t.cat==="brake";
  const accent=isBrake?"#fb923c":sv.c;
  return(
    <div className={t.x?"tout":"tin"} style={{width:320,borderRadius:10,overflow:"hidden",
      background:isBrake?"#130a02":"var(--surf)",
      border:`1.5px solid ${accent}`,
      boxShadow:`0 4px 32px ${accent}44,0 2px 10px rgba(0,0,0,.7)`}}>
      <div style={{padding:"9px 12px",display:"flex",alignItems:"center",gap:9,
        background:`${accent}22`,borderBottom:`1px solid ${accent}33`}}>
        <span style={{fontSize:14}}>{isBrake?"🛑":"🚨"}</span>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"var(--hd)",fontSize:13,letterSpacing:".12em",color:accent,lineHeight:1}}>
            {isBrake?"BRAKE APPLIED":"PACKET INJECTED & SENT"}
          </div>
          <div style={{fontSize:9,color:"var(--ts)",fontFamily:"var(--mono)",marginTop:2}}>
            {t.pkt} · {t.field} · bit {t.bit} · val={t.val} · {t.subs} subs
          </div>
        </div>
        <button onClick={()=>onX(t.id)} style={{background:"transparent",border:`1px solid ${accent}44`,borderRadius:4,width:20,height:20,color:accent,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>×</button>
      </div>
      <div style={{padding:"10px 12px"}}>
        <div style={{display:"flex",gap:5,marginBottom:8,flexWrap:"wrap"}}>
          <span className="tag" style={{background:`${accent}18`,color:accent,border:`1px solid ${accent}44`}}>{t.pkt}</span>
          <span className="tag" style={{background:"var(--raised)",color:"var(--ts)",border:"1px solid var(--bdr2)"}}>{t.field}</span>
          {t.catLabel&&<span className="tag" style={{background:`${accent}10`,color:accent,border:`1px solid ${accent}33`}}>{t.catLabel}</span>}
        </div>
        <div style={{background:"var(--raised)",border:`1px solid ${accent}33`,
          borderLeft:`3px solid ${accent}`,borderRadius:6,padding:"8px 11px"}}>
          <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:3}}>
            {isBrake?"🛑 BRAKE TYPE":"INJECTED VALUE"}
          </div>
          <div style={{fontSize:13,fontWeight:700,color:accent,lineHeight:1.4}}>{t.label}</div>
        </div>
      </div>
      <div style={{height:3,background:"var(--bdr)"}}>
        <div style={{height:"100%",background:accent,animation:`tbar ${t.dur}ms linear forwards`}}/>
      </div>
    </div>
  );
}

function RadioPanel({pkt,field,onSend,onStage,disabled,mode,stagedVal}){
  const [localSel,setLocalSel]=useState(null);
  const isMulti=mode==="multi";
  const activeSel=isMulti?stagedVal:localSel;
  const opt=activeSel!==null?field.options.find(o=>o.val===activeSel):null;
  const sv=opt?.sev?S[opt.sev]:null;
  const armed=!isMulti&&opt&&opt.sev!==null;
  const isStaged=isMulti&&stagedVal!==null;
  const stageColor=isStaged?(opt?.sev?S[opt.sev].c:"var(--amber)"):"var(--bdr)";
  const handleClick=(o,e)=>{e.stopPropagation();if(isMulti)onStage(o);else setLocalSel(v=>v===o.val?null:o.val);};
  const fire=(e)=>{e.stopPropagation();if(!armed)return;onSend({pkt,field,opt,payload:injectBits(pkt.base,field.bitStart,field.bitLen,opt.val),cat:field.cat});};
  const clear=(e)=>{e.stopPropagation();if(isMulti)onStage({val:null,text:"",sev:null});else setLocalSel(null);};
  return(
    <div style={{borderRadius:8,border:`1px solid ${isStaged?stageColor+"66":armed?sv.c+"55":"var(--bdr)"}`,background:isStaged?(opt?.sev?S[opt.sev].bg:"rgba(245,158,11,.07)"):armed?sv.bg:"var(--raised)",transition:"all .25s"}}>
      <div style={{padding:"6px 12px",display:"flex",alignItems:"center",gap:8,background:isStaged?(opt?.sev?S[opt.sev].c+"1a":"rgba(245,158,11,.1)"):armed?sv.c+"1a":"var(--surf)",borderBottom:`1px solid ${isStaged?stageColor+"33":armed?sv.c+"33":"var(--bdr)"}`,borderRadius:"8px 8px 0 0"}}>
        <div style={{width:8,height:8,borderRadius:"50%",flexShrink:0,background:isStaged?stageColor:armed?sv.c:"var(--bdr2)",boxShadow:isStaged||armed?`0 0 8px ${isStaged?stageColor:sv.c}`:"none",transition:"all .3s"}}/>
        <span style={{fontSize:10,fontFamily:"var(--mono)",fontWeight:700,letterSpacing:".05em",color:isStaged?stageColor:armed?sv.c:"var(--ts)",textTransform:"uppercase",flex:1}}>{field.fieldName}</span>
        <span style={{fontSize:8,color:"var(--td)",fontFamily:"var(--mono)"}}>bit {field.bitStart} · {field.bitLen}b</span>
        {isMulti&&isStaged&&<span className="tag" style={{background:"rgba(245,158,11,.2)",color:"var(--amber)",border:"1px solid rgba(245,158,11,.5)",flexShrink:0}}>✓ STAGED</span>}
        {activeSel!==null&&<button onClick={clear} style={{fontSize:8,padding:"2px 8px",borderRadius:4,border:`1px solid ${isStaged?stageColor+"66":armed?sv.c+"55":"var(--bdr2)"}`,background:"transparent",color:isStaged?stageColor:armed?sv.c:"var(--tm)",fontFamily:"var(--mono)",fontWeight:700,cursor:"pointer",flexShrink:0}}>CLEAR</button>}
      </div>
      <div style={{padding:"8px 10px",display:"flex",flexDirection:"column",gap:4}}>
        {field.options.map(o=>{
          const isSel=activeSel===o.val;
          const os=o.sev?S[o.sev]:null;
          const cls=isSel?(o.sev?`opt-row sel-${o.sev}`:"opt-row sel-none"):"opt-row";
          return(
            <div key={o.val} className={cls} onClick={e=>handleClick(o,e)}>
              <div style={{width:13,height:13,borderRadius:"50%",flexShrink:0,border:`2px solid ${isSel?(os?.c||"var(--bdr3)"):"var(--bdr2)"}`,background:isSel?(os?.c||"var(--bdr3)"):"transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .14s"}}>
                {isSel&&<div style={{width:4,height:4,borderRadius:"50%",background:"#fff"}}/>}
              </div>
              <span style={{fontSize:9,fontFamily:"var(--mono)",fontWeight:700,padding:"1px 5px",borderRadius:3,background:"var(--hover)",color:"var(--td)",border:"1px solid var(--bdr)",flexShrink:0,minWidth:24,textAlign:"center"}}>{o.val}</span>
              {o.sev&&<span style={{fontSize:11,flexShrink:0}}>{S[o.sev]?.icon}</span>}
              <span style={{fontSize:10,fontFamily:"var(--mono)",color:isSel?(os?.c||"var(--tp)"):"var(--ts)",fontWeight:isSel?600:400,flex:1,lineHeight:1.35}}>{o.text}</span>
              {isMulti?<span style={{fontSize:9,color:isSel?"var(--amber)":"var(--td)",flexShrink:0}}>{isSel?"☑":"☐"}</span>:o.sev&&isSel&&<span className="tag" style={{background:os.bg,color:os.c,border:`1px solid ${os.ring}`,flexShrink:0}}>{os.label}</span>}
            </div>
          );
        })}
      </div>
      {!isMulti&&armed&&(
        <div style={{padding:"6px 12px",borderTop:`1px solid ${sv.c}33`,background:sv.c+"0f",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span style={{fontSize:8,color:sv.c,fontFamily:"var(--mono)",fontWeight:700}}>INJECT:</span>
          <span style={{fontSize:8,color:"var(--ts)",fontFamily:"var(--mono)"}}>{field.fieldName} = <span style={{color:sv.c,fontWeight:700}}>{opt.val}</span> ({opt.val.toString(2).padStart(field.bitLen,"0")}b) [{field.bitStart}–{field.bitStart+field.bitLen-1}]</span>
          <button onClick={fire} disabled={disabled} className="armed" style={{marginLeft:"auto",padding:"5px 14px",borderRadius:6,border:`1.5px solid ${sv.c}`,background:`linear-gradient(135deg,${sv.c},${sv.c}cc)`,color:"#fff",fontSize:10,fontFamily:"var(--mono)",fontWeight:800,letterSpacing:".07em",cursor:"pointer"}}>SEND THIS PACKET 🚀</button>
        </div>
      )}
      {isMulti&&!isStaged&&(<div style={{padding:"5px 12px",borderTop:"1px solid var(--bdr)",background:"rgba(245,158,11,.03)",textAlign:"center"}}><span style={{fontSize:8,color:"var(--td)",fontFamily:"var(--mono)"}}>Click a value to stage it into the combined packet</span></div>)}
    </div>
  );
}

function PresetPanel({pkt,field,onSend,onStage,disabled,mode,stagedVal}){
  const [selVal,setSelVal]=useState(null);
  const [customVal,setCustomVal]=useState("");
  const [useCustom,setUseCustom]=useState(false);
  const isMulti=mode==="multi";
  const localFinal=useCustom?parseInt(customVal||"0"):selVal;
  const maxVal=(1<<field.bitLen)-1;
  const isLocalValid=localFinal!==null&&!isNaN(localFinal)&&localFinal>=0&&localFinal<=maxVal;
  const isStaged=isMulti&&stagedVal!==null;
  const handleStageOrSend=(val)=>{
    if(!isMulti){if(isLocalValid)onSend({pkt,field,opt:{val,text:`${field.fieldName}=${val}`,sev:null},payload:injectBits(pkt.base,field.bitStart,field.bitLen,val),cat:field.cat,isPreset:true});}
    else{onStage({val,text:`${field.fieldName}=${val}`,sev:null});}
  };
  return(
    <div style={{borderRadius:8,border:`1px solid ${isStaged?"var(--amber)88":isLocalValid?"var(--amber)55":"var(--bdr)"}`,background:isStaged?"rgba(245,158,11,.08)":isLocalValid?"rgba(245,158,11,.05)":"var(--raised)",transition:"all .25s"}}>
      <div style={{padding:"6px 12px",display:"flex",alignItems:"center",gap:8,background:"var(--surf)",borderBottom:"1px solid var(--bdr)",borderRadius:"8px 8px 0 0"}}>
        <div style={{width:8,height:8,borderRadius:"50%",flexShrink:0,background:isStaged||isLocalValid?"var(--amber)":"var(--bdr2)",boxShadow:isStaged||isLocalValid?"0 0 8px var(--amber)":"none",transition:"all .3s"}}/>
        <span style={{fontSize:10,fontFamily:"var(--mono)",fontWeight:700,letterSpacing:".05em",color:isStaged||isLocalValid?"var(--amber)":"var(--ts)",textTransform:"uppercase",flex:1}}>{field.fieldName}</span>
        <span style={{fontSize:8,color:"var(--td)",fontFamily:"var(--mono)"}}>bit {field.bitStart} · {field.bitLen}b · 0–{maxVal}</span>
        {isMulti&&isStaged&&<span className="tag" style={{background:"rgba(245,158,11,.2)",color:"var(--amber)",border:"1px solid rgba(245,158,11,.5)"}}>✓ STAGED = {stagedVal}</span>}
        {isMulti&&isStaged&&<button onClick={e=>{e.stopPropagation();onStage({val:null,text:"",sev:null});}} style={{fontSize:8,padding:"2px 8px",borderRadius:4,border:"1px solid rgba(245,158,11,.5)",background:"transparent",color:"var(--amber)",fontFamily:"var(--mono)",fontWeight:700,cursor:"pointer",flexShrink:0}}>CLEAR</button>}
      </div>
      {field.note&&<div style={{padding:"5px 12px",fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",borderBottom:"1px solid var(--bdr)",background:"var(--raised)",lineHeight:1.6}}>{field.note}</div>}
      <div style={{padding:"8px 10px",display:"flex",flexDirection:"column",gap:4}}>
        {field.presets.map(pr=>{
          const isActivePr=isMulti?(stagedVal===pr.val):(selVal===pr.val&&!useCustom);
          return(<button key={pr.val} className={`preset-btn${isActivePr?" active-preset":""}`} onClick={e=>{e.stopPropagation();setSelVal(pr.val);setUseCustom(false);if(isMulti)handleStageOrSend(pr.val);}}>
            <span style={{fontSize:10,fontFamily:"var(--mono)",fontWeight:700,padding:"1px 6px",borderRadius:3,background:"var(--hover)",color:"var(--td)",border:"1px solid var(--bdr)",flexShrink:0,minWidth:32,textAlign:"center"}}>{pr.val}</span>
            <span style={{flex:1}}>{pr.text}</span>
            <span style={{fontSize:9,color:isActivePr?"var(--amber)":"var(--td)",flexShrink:0}}>{isMulti?(isActivePr?"☑":"☐"):(isActivePr?"◉":"")}</span>
          </button>);
        })}
        <div style={{display:"flex",gap:6,alignItems:"center",marginTop:2}}>
          <span style={{fontSize:9,color:"var(--tm)",fontFamily:"var(--mono)",flexShrink:0}}>CUSTOM:</span>
          <input type="number" min="0" max={maxVal} value={customVal} onChange={e=>{setCustomVal(e.target.value);setUseCustom(true);}} onClick={e=>e.stopPropagation()} placeholder={`0–${maxVal}`} style={{flex:1,padding:"4px 8px",borderRadius:5,background:"var(--inp)",border:`1px solid ${useCustom&&isLocalValid?"var(--amber)":"var(--bdr)"}`,color:"var(--tp)",fontSize:10,outline:"none"}}/>
          <span style={{fontSize:9,color:"var(--td)",fontFamily:"var(--mono)",flexShrink:0}}>/{maxVal}</span>
          {isMulti&&useCustom&&isLocalValid&&(<button onClick={e=>{e.stopPropagation();handleStageOrSend(localFinal);}} style={{padding:"3px 9px",borderRadius:5,border:"1px solid var(--amber)",background:"rgba(245,158,11,.15)",color:"var(--amber)",fontSize:9,fontFamily:"var(--mono)",fontWeight:700,cursor:"pointer"}}>STAGE</button>)}
        </div>
      </div>
      {!isMulti&&(<div style={{padding:"6px 12px",borderTop:"1px solid var(--bdr)",background:"rgba(245,158,11,.05)",display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)"}}>{isLocalValid?`INJECT ${field.fieldName}=${localFinal} (${localFinal.toString(2).padStart(field.bitLen,"0")}b) [${field.bitStart}–${field.bitStart+field.bitLen-1}]`:"Select or enter a value above"}</span>
        <button onClick={e=>{e.stopPropagation();handleStageOrSend(localFinal);}} disabled={disabled||!isLocalValid} style={{marginLeft:"auto",padding:"5px 14px",borderRadius:6,border:`1.5px solid ${isLocalValid?"var(--amber)":"var(--bdr)"}`,background:isLocalValid?"linear-gradient(135deg,#f59e0b,#d97706)":"var(--raised)",color:isLocalValid?"#fff":"var(--td)",fontSize:10,fontFamily:"var(--mono)",fontWeight:800,letterSpacing:".07em",cursor:isLocalValid?"pointer":"not-allowed"}}>SEND THIS PACKET 🚀</button>
      </div>)}
    </div>
  );
}

function MultiStagePanel({pkt,staged,onClear,onSend,disabled}){
  const entries=Object.values(staged);
  const hasAny=entries.length>0;
  const topSev=entries.find(e=>e.opt.sev==="critical")?.opt.sev||entries.find(e=>e.opt.sev==="high")?.opt.sev||entries.find(e=>e.opt.sev==="medium")?.opt.sev||entries.find(e=>e.opt.sev==="info")?.opt.sev||null;
  const accentColor=topSev?S[topSev].c:"var(--amber)";
  return(
    <div style={{borderRadius:10,overflow:"hidden",border:`2px solid ${hasAny?accentColor+"66":"var(--bdr)"}`,background:hasAny?`${accentColor}08`:"var(--raised)",transition:"all .25s"}}>
      <div style={{padding:"9px 14px",display:"flex",alignItems:"center",gap:9,background:hasAny?`${accentColor}18`:"var(--surf)",borderBottom:`1px solid ${hasAny?accentColor+"33":"var(--bdr)"}`}}>
        <span style={{fontSize:16}}>⚡⚡</span>
        <div style={{flex:1}}><div style={{fontFamily:"var(--hd)",fontSize:13,letterSpacing:".1em",color:hasAny?accentColor:"var(--tm)",lineHeight:1}}>MULTI-FIELD PACKET</div><div style={{fontSize:8,color:"var(--ts)",fontFamily:"var(--mono)",marginTop:2}}>{hasAny?`${entries.length} field${entries.length>1?"s":""} staged — all bits injected into ONE packet`:"No fields staged yet. Select values in the panels above."}</div></div>
        {hasAny&&<button onClick={e=>{e.stopPropagation();onClear();}} style={{fontSize:8,padding:"3px 9px",borderRadius:5,cursor:"pointer",border:`1px solid ${accentColor}55`,background:"transparent",color:accentColor,fontFamily:"var(--mono)",fontWeight:700}}>CLEAR ALL</button>}
      </div>
      {hasAny&&(<div style={{padding:"8px 14px",display:"flex",flexDirection:"column",gap:5}}>{entries.map((e,i)=>{const sv=e.opt.sev?S[e.opt.sev]:null;const col=sv?.c||"var(--amber)";return(<div key={e.field.fieldName} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:6,background:`${col}0e`,border:`1px solid ${col}44`}}><span style={{fontSize:10,fontFamily:"var(--mono)",fontWeight:700,padding:"1px 6px",borderRadius:3,background:`${col}22`,color:col,border:`1px solid ${col}44`,flexShrink:0}}>#{i+1}</span><span style={{fontSize:10,fontFamily:"var(--mono)",fontWeight:700,color:col,flex:1}}>{e.field.fieldName}</span><span style={{fontSize:9,fontFamily:"var(--mono)",color:"var(--ts)"}}>= {e.opt.val} ({e.opt.val.toString(2).padStart(e.field.bitLen,"0")}b)</span><span style={{fontSize:8,color:"var(--td)",fontFamily:"var(--mono)",flexShrink:0}}>bit {e.field.bitStart}</span>{sv&&<span className="tag" style={{background:sv.bg,color:sv.c,border:`1px solid ${sv.ring}`,flexShrink:0}}>{sv.label}</span>}</div>);})}</div>)}
      {hasAny&&(<div style={{padding:"5px 14px",borderTop:`1px solid ${accentColor}22`,background:"rgba(0,0,0,.15)",fontSize:8,color:"var(--td)",fontFamily:"var(--mono)",lineHeight:1.7}}><span style={{color:accentColor,fontWeight:700}}>INJECT ORDER: </span>{entries.map((e,i)=>(<span key={e.field.fieldName}>{i>0&&<span style={{color:"var(--bdr3)"}}> → </span>}<span style={{color:"var(--ts)"}}>{e.field.fieldName}</span><span style={{color:accentColor}}>={e.opt.val}</span><span style={{color:"var(--td)"}}>[{e.field.bitStart}]</span></span>))}</div>)}
      <div style={{padding:"10px 14px",background:hasAny?`${accentColor}0c`:"transparent",borderTop:`1px solid ${hasAny?accentColor+"33":"var(--bdr)"}`}}>
        <button onClick={e=>{e.stopPropagation();onSend();}} disabled={disabled||!hasAny} className={hasAny?"armed":""} style={{width:"100%",padding:"10px 0",borderRadius:8,border:`2px solid ${hasAny?accentColor:"var(--bdr)"}`,background:hasAny?`linear-gradient(135deg,${accentColor},${accentColor}bb)`:"var(--raised)",color:hasAny?"#fff":"var(--td)",fontSize:12,fontFamily:"var(--mono)",fontWeight:900,letterSpacing:".1em",cursor:hasAny?"pointer":"not-allowed",transition:"all .2s",boxShadow:hasAny?`0 0 20px ${accentColor}44`:"none"}}>{hasAny?`⚡ TRANSMIT ${entries.length}-FIELD PACKET → PINJ LIVE`:"Stage fields above then transmit"}</button>
      </div>
    </div>
  );
}

function ThemeTog({light,onT}){
  const[sp,setSp]=useState(false);
  return(<button className={`tog${light?" on":""}`} onClick={()=>{setSp(true);onT();setTimeout(()=>setSp(false),400);}}>
    <div className="tog-t" style={{animation:sp?"tspin .4s ease":"none"}}>{light?"☀️":"🌙"}</div>
  </button>);
}

function Stat({label,val,color}){
  return(<div style={{flex:"1 1 0",background:"var(--raised)",borderRadius:8,padding:"10px 12px",border:`1px solid var(--bdr)`,borderTop:`2px solid ${color}`}}>
    <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:".1em",marginBottom:3}}>{label}</div>
    <div style={{fontSize:22,fontWeight:700,fontFamily:"var(--mono)",color,lineHeight:1}}>{val}</div>
  </div>);
}

/* ════════════════════════════════════
   MAIN PacketSimulator
════════════════════════════════════ */
export default function PacketSimulator(){
  const[light,setLight]=useState(()=>localStorage.getItem("kavach-theme")==="light");
  const[page,setPage]=useState("sim"); // "sim" | "dmi" | "log"
  const[sending,setSending]=useState(false);
  const[ms,setMs]=useState(2000);
  const[src,setSrc]=useState("simulator");
  const[mode,setMode]=useState("cycle");
  const[fixIdx,setFixIdx]=useState(0);
  const[log,setLog]=useState([]);
  const[sent,setSent]=useState(0);
  const[oks,setOks]=useState(0);
  const[errs,setErrs]=useState(0);
  const[be,setBe]=useState(null);
  const[last,setLast]=useState(null);
  const[prog,setProg]=useState(0);
  const[toasts,setToasts]=useState([]);
  const[expandedCards,setExpandedCards]=useState(()=>new Set(["c46"]));
  const[activeCats,setActiveCats]=useState({});

  const tmr=useRef(null),prf=useRef(null),cyc=useRef(0),logR=useRef(null);

  useEffect(()=>{document.documentElement.classList.toggle("light",light);localStorage.setItem("kavach-theme",light?"light":"dark");},[light]);
  // theme changed in the PINJ tab → follow it here (and vice versa, App listens too)
  useEffect(()=>{const on=e=>{if(e.key==="kavach-theme"&&e.newValue)setLight(e.newValue==="light");};window.addEventListener("storage",on);return()=>window.removeEventListener("storage",on);},[]);
  useEffect(()=>{
    const c=()=>fetch(HEALTH_URL,{signal:AbortSignal.timeout(2000)}).then(()=>setBe(true)).catch(()=>setBe(false));
    c();const t=setInterval(c,4000);return()=>clearInterval(t);
  },[]);
  useEffect(()=>{if(logR.current)logR.current.scrollTop=logR.current.scrollHeight;},[log]);
  useEffect(()=>{
    if(!sending){setProg(0);return;}
    setProg(0);const t0=Date.now();
    const tick=()=>{const p=Math.min(100,((Date.now()-t0)/ms)*100);setProg(p);if(p<100)prf.current=requestAnimationFrame(tick);};
    prf.current=requestAnimationFrame(tick);return()=>cancelAnimationFrame(prf.current);
  },[sending,ms,last]);

  const addToast=useCallback(d=>{
    const id=Date.now()+Math.random(),dur=9000;
    setToasts(p=>[...p.slice(-3),{...d,id,x:false,dur}]);
    setTimeout(()=>{setToasts(p=>p.map(t=>t.id===id?{...t,x:true}:t));setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),300);},dur);
  },[]);
  const xToast=useCallback(id=>{setToasts(p=>p.map(t=>t.id===id?{...t,x:true}:t));setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),300);},[]);
  const addLog=useCallback(e=>{
    const ts=new Date().toLocaleTimeString("en-GB",{hour12:false});
    setLog(p=>[...p.slice(-499),{ts,id:Date.now()+Math.random(),...e}]);
  },[]);

  const post=useCallback(async(radio,payload,meta)=>{
    try{
      const r=await fetch(INGEST_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({packets:[{activeRadio:radio,messagePayload:payload}],source:src})});
      const d=await r.json();
      setSent(n=>n+1);setOks(n=>n+1);
      setLast({label:meta.label,color:meta.color,name:meta.name,payload});
      addLog({...meta,hex:payload.slice(0,14),subs:d.subscribers_notified||0});
      return d;
    }catch(e){
      setErrs(n=>n+1);addLog({type:"error",label:"ERR",color:"#ef4444",name:`Send failed: ${e.message}`});
      setBe(false);return null;
    }
  },[src,addLog]);

  const sendClean=useCallback(async(pkt)=>{
    await post(pkt.radio,pkt.base,{type:"clean",label:pkt.label,color:pkt.color,name:pkt.name,abbr:pkt.abbr});
  },[post]);

  const sendAuto=useCallback(async()=>{
    let p;
    if(mode==="cycle"){p=PACKETS[cyc.current%PACKETS.length];cyc.current++;}
    else if(mode==="random")p=PACKETS[Math.floor(Math.random()*PACKETS.length)];
    else p=PACKETS[fixIdx];
    await sendClean(p);
  },[mode,fixIdx,sendClean]);

  const sendField=useCallback(async({pkt,field,opt,payload,cat,isPreset})=>{
    const catMeta=CATS[cat]||{label:cat,icon:"•"};
    const d=await post(pkt.radio,payload,{
      type:cat==="brake"?"brake":"inject",
      label:pkt.label,color:pkt.color,name:pkt.name,abbr:pkt.abbr,
      fieldName:field.fieldName,fieldText:opt.text,fieldVal:opt.val,
      fieldBit:field.bitStart,fieldLen:field.bitLen,fieldSev:opt.sev,catLabel:catMeta.label,
    });
    if(d){
      const accent=cat==="brake"?"#fb923c":(opt.sev?S[opt.sev].c:"#60a5fa");
      addToast({pkt:pkt.label,field:field.fieldName,label:opt.text,bit:field.bitStart,val:opt.val,sev:opt.sev,cat,catLabel:catMeta.icon+" "+catMeta.label,subs:d.subscribers_notified||0});
    }
  },[post,addToast]);

  const startAuto=useCallback(()=>{
    if(tmr.current)return;setSending(true);
    addLog({type:"info",label:"SYS",color:"var(--tm)",name:`Auto-send · ${ms<1000?ms+"ms":ms/1000+"s"} · ${mode}`});
    sendAuto();tmr.current=setInterval(sendAuto,ms);
  },[ms,mode,sendAuto,addLog]);
  const stopAuto=useCallback(()=>{
    clearInterval(tmr.current);tmr.current=null;cancelAnimationFrame(prf.current);
    setSending(false);setProg(0);addLog({type:"info",label:"SYS",color:"var(--tm)",name:"Auto-send stopped"});
  },[addLog]);

  const toggleCard=id=>setExpandedCards(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
  const setCardCat=(id,cat)=>setActiveCats(p=>({...p,[id]:cat}));

  const[sendMode,setSendMode]=useState({});
  const[staged,setStaged]=useState({});
  const getSendMode=id=>sendMode[id]||"single";
  const stageField=(pktId,field,opt)=>{
    setStaged(prev=>{
      const cur=prev[pktId]||{};
      if(cur[field.fieldName]?.val===opt.val){const next={...cur};delete next[field.fieldName];return{...prev,[pktId]:next};}
      return{...prev,[pktId]:{...cur,[field.fieldName]:{field,opt,val:opt.val}}};
    });
  };
  const clearStaged=pktId=>setStaged(prev=>({...prev,[pktId]:{}}));
  const sendMulti=useCallback(async(pkt)=>{
    const entries=Object.values(staged[pkt.id]||{});
    if(entries.length===0)return;
    let payload=pkt.base;
    for(const{field,opt}of entries)payload=injectBits(payload,field.bitStart,field.bitLen,opt.val);
    const fieldSummary=entries.map(e=>`${e.field.fieldName}=${e.opt.val}`).join(", ");
    const topSev=entries.find(e=>e.opt.sev==="critical")?.opt.sev||entries.find(e=>e.opt.sev==="high")?.opt.sev||entries.find(e=>e.opt.sev==="medium")?.opt.sev||entries.find(e=>e.opt.sev==="info")?.opt.sev||null;
    const d=await post(pkt.radio,payload,{type:"multi",label:pkt.label,color:pkt.color,name:pkt.name,abbr:pkt.abbr,fieldName:"MULTI",fieldText:fieldSummary,fieldVal:entries.length,fieldBit:0,fieldLen:0,fieldSev:topSev,catLabel:`${entries.length} fields combined`});
    if(d&&topSev)addToast({pkt:pkt.label,field:`${entries.length} fields`,label:fieldSummary,bit:"-",val:entries.length,sev:topSev,cat:"multi",catLabel:`⚡ ${entries.length} fields combined`,subs:d.subscribers_notified||0});
  },[staged,post,addToast]);

  const bc=be===true?"var(--green)":be===false?"var(--red)":"var(--amber)";
  const bl=be===true?"ONLINE":be===false?"OFFLINE":"CHECKING";
  // all three pages stay mounted (only hidden) so a loaded log, a running replay or
  // DMI SIM state survive switching between SIMULATOR / DMI SIM / LOG REPLAY
  const pageBox=p=>({display:page===p?"flex":"none",flexDirection:"column",flex:1,minHeight:0,overflow:"hidden"});

  return(
    <>
      <style>{CSS}</style>
      <div style={{position:"fixed",bottom:20,right:20,zIndex:9999,display:"flex",flexDirection:"column-reverse",gap:8,pointerEvents:"none"}}>
        {toasts.map(t=><div key={t.id} style={{pointerEvents:"all"}}><Toast t={t} onX={xToast}/></div>)}
      </div>

      <div style={{display:"flex",flexDirection:"column",height:"100vh",width:"100vw",overflow:"hidden",background:"var(--void)"}}>
        {/* TOPBAR */}
        <div style={{height:52,display:"flex",alignItems:"center",gap:12,padding:"0 18px",background:"var(--topbg)",borderBottom:"1px solid var(--topbdr)",flexShrink:0,zIndex:10}}>
          <div className="kv-nova-logo" title="NOVA — Engineering Safety · Powering Innovation">
            <span className="kv-nova-logo-markwrap"><img src="/nova-mark.png" alt="" draggable={false} className="kv-nova-logo-mark" /></span>
            <span className="kv-nova-logo-wordwrap"><img src="/nova-text-dark.png" alt="NOVA" draggable={false} className="kv-nova-logo-word" /><span className="kv-nova-logo-shine" aria-hidden="true" /></span>
          </div>
          <div className="kv-nova-divider" aria-hidden="true" />
          <a href="/" className="kv-back" title="Back to PINJ">← PINJ</a>
          <div style={{width:1,height:24,background:"var(--bdr2)",flexShrink:0}}/>
          <div style={{width:30,height:30,borderRadius:7,background:"linear-gradient(135deg,#10b981,#059669)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0,boxShadow:"0 0 12px rgba(16,185,129,.35)"}}>📤</div>
          <div>
            <div style={{fontFamily:"var(--hd)",fontSize:16,letterSpacing:".14em",color:"#10b981",lineHeight:1}}>PACKET SIMULATOR</div>
            <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginTop:2,letterSpacing:".04em"}}>KAVACH PINJ · ADVANCED BIT-LEVEL TEST TOOL · RDSO/SPN/196/2020 V4.0</div>
          </div>
          <div style={{display:"flex",gap:5,marginLeft:12,flexWrap:"wrap"}}>
            {PACKETS.map(p=><span key={p.id} className="tag" style={{background:`${p.color}18`,color:p.color,border:`1px solid ${p.color}44`}}>{p.label}</span>)}
          </div>

          {/* ── PAGE TABS ── */}
          <div style={{display:"flex",gap:4,marginLeft:16}}>
            <button onClick={()=>setPage("sim")}
              style={{padding:"5px 12px",borderRadius:5,fontSize:10,fontFamily:"var(--mono)",fontWeight:700,cursor:"pointer",border:`1px solid ${page==="sim"?"#10b98166":"var(--bdr)"}`,background:page==="sim"?"rgba(16,185,129,.12)":"transparent",color:page==="sim"?"#10b981":"var(--tm)",transition:"all .15s"}}>
              📤 SIMULATOR
            </button>
            <button onClick={()=>setPage("dmi")}
              style={{padding:"5px 12px",borderRadius:5,fontSize:10,fontFamily:"var(--mono)",fontWeight:700,cursor:"pointer",border:`1px solid ${page==="dmi"?"#00ff0066":"var(--bdr)"}`,background:page==="dmi"?"rgba(0,255,0,.08)":"transparent",color:page==="dmi"?"#00FF00":"var(--tm)",transition:"all .15s",boxShadow:page==="dmi"?"0 0 10px rgba(0,255,0,.2)":"none"}}>
              🚆 DMI SIM
            </button>
            <button onClick={()=>setPage("log")}
              style={{padding:"5px 12px",borderRadius:5,fontSize:10,fontFamily:"var(--mono)",fontWeight:700,cursor:"pointer",border:`1px solid ${page==="log"?"#06b6d466":"var(--bdr)"}`,background:page==="log"?"rgba(6,182,212,.12)":"transparent",color:page==="log"?"#06b6d4":"var(--tm)",transition:"all .15s"}}>
              📂 LOG REPLAY
            </button>
          </div>

          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:6,border:`1px solid ${bc}44`,background:`${bc}10`}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:bc,animation:be===null?"pdot 1.2s infinite":"none"}}/>
            <span style={{fontSize:9,fontFamily:"var(--mono)",fontWeight:700,color:bc}}>BACKEND {bl}</span>
          </div>
          <UserChip/>
          <ThemeTog light={light} onT={()=>setLight(l=>!l)}/>
        </div>

        {/* PAGE CONTENT */}
        <div style={pageBox("dmi")}><DmiSim be={be}/></div>
        <div style={pageBox("log")}><LogReplay be={be}/></div>
        <div style={pageBox("sim")}>
          {/* 3 COLUMNS */}
          <div style={{flex:1,display:"grid",gridTemplateColumns:"248px 1fr 300px",overflow:"hidden",minHeight:0}}>

            {/* COL 1: Controls */}
            <div style={{background:"var(--surf)",borderRight:"1px solid var(--bdr)",display:"flex",flexDirection:"column",overflowY:"auto",minHeight:0}}>
              <div style={{padding:"7px 13px",background:"var(--raised)",borderBottom:"1px solid var(--bdr)",fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:".12em",flexShrink:0}}>CONFIGURATION</div>
              <div style={{padding:"13px",borderBottom:"1px solid var(--bdr)"}}>
                <div style={{fontSize:9,color:"var(--tm)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:7}}>Auto-send Interval</div>
                <div style={{display:"flex",gap:4,marginBottom:7}}>
                  {[500,1000,2000,5000].map(v=>(
                    <button key={v} onClick={()=>{setMs(v);if(sending){stopAuto();setTimeout(startAuto,80);}}}
                      style={{flex:1,padding:"5px 0",borderRadius:5,cursor:"pointer",border:`1px solid ${ms===v?"var(--amber)":"var(--bdr)"}`,background:ms===v?"var(--aglow)":"var(--raised)",color:ms===v?"var(--amber)":"var(--ts)",fontSize:9,fontFamily:"var(--mono)",fontWeight:ms===v?700:400,transition:"all .14s"}}>
                      {v<1000?v+"ms":v/1000+"s"}
                    </button>
                  ))}
                </div>
                <input type="range" min="200" max="10000" step="100" value={ms} onChange={e=>{setMs(Number(e.target.value));if(sending){stopAuto();setTimeout(startAuto,80);}}} style={{width:"100%",accentColor:"var(--amber)"}}/>
                <div style={{textAlign:"right",fontSize:10,color:"var(--amber)",fontFamily:"var(--mono)",marginTop:4}}>{ms<1000?ms+"ms":ms/1000+"s"}</div>
              </div>
              <div style={{padding:"13px",borderBottom:"1px solid var(--bdr)"}}>
                <div style={{fontSize:9,color:"var(--tm)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:7}}>Auto-send Mode</div>
                <div style={{display:"flex",gap:4,marginBottom:mode==="fixed"?8:0}}>
                  {[{id:"cycle",l:"Cycle",i:"↻"},{id:"random",l:"Random",i:"⚄"},{id:"fixed",l:"Fixed",i:"◈"}].map(m=>(
                    <button key={m.id} onClick={()=>setMode(m.id)}
                      style={{flex:1,padding:"7px 0",borderRadius:6,cursor:"pointer",border:`1px solid ${mode===m.id?"var(--cyan)":"var(--bdr)"}`,background:mode===m.id?"rgba(6,182,212,.12)":"var(--raised)",color:mode===m.id?"var(--cyan)":"var(--ts)",fontSize:9,fontFamily:"var(--mono)",fontWeight:mode===m.id?700:400,transition:"all .14s",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                      <span style={{fontSize:13}}>{m.i}</span><span>{m.l}</span>
                    </button>
                  ))}
                </div>
                {mode==="fixed"&&(<select value={fixIdx} onChange={e=>setFixIdx(Number(e.target.value))} style={{width:"100%",padding:"6px 9px",borderRadius:5,background:"var(--raised)",border:"1px solid var(--bdr)",color:"var(--tp)",fontSize:10,outline:"none"}}>{PACKETS.map((p,i)=><option key={i} value={i}>{p.label} — {p.name}</option>)}</select>)}
              </div>
              <div style={{padding:"13px",borderBottom:"1px solid var(--bdr)"}}>
                <div style={{fontSize:9,color:"var(--tm)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:5}}>Source Label</div>
                <input value={src} onChange={e=>setSrc(e.target.value)} placeholder="simulator" style={{width:"100%",padding:"7px 10px",borderRadius:5,background:"var(--inp)",border:"1px solid var(--bdr)",color:"var(--cyan)",fontSize:11,outline:"none"}} onFocus={e=>e.target.style.borderColor="var(--cyan)"} onBlur={e=>e.target.style.borderColor="var(--bdr)"}/>
              </div>
              <div style={{padding:"13px",borderBottom:"1px solid var(--bdr)"}}>
                <div style={{fontSize:9,color:"var(--tm)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:8}}>Test Categories</div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {Object.entries(CATS).map(([k,c])=>(<div key={k} style={{display:"flex",alignItems:"center",gap:7}}><span style={{fontSize:11}}>{c.icon}</span><span style={{fontSize:9,fontFamily:"var(--mono)",color:"var(--ts)"}}>{c.label}</span><div style={{marginLeft:"auto",width:7,height:7,borderRadius:"50%",background:c.color}}/></div>))}
                </div>
              </div>
              <div style={{padding:"13px",display:"flex",flexDirection:"column",gap:7}}>
                <button onClick={sending?stopAuto:startAuto} disabled={be===false&&!sending} className={sending?undefined:"cine-cta"}
                  style={{position:"relative",overflow:"hidden",padding:"13px 0",borderRadius:8,border:"none",fontSize:12,fontWeight:800,fontFamily:"var(--mono)",letterSpacing:".1em",color:"#fff",transition:"all .2s",background:sending?"linear-gradient(135deg,#dc2626,#991b1b)":"linear-gradient(135deg,#f59e0b,#d97706)",boxShadow:sending?"0 0 20px rgba(220,38,38,.35)":"0 0 20px rgba(245,158,11,.25)"}}>
                  {sending?"⏹ STOP AUTO-SEND":"▶ START AUTO-SEND"}
                  {sending&&<div style={{position:"absolute",bottom:0,left:0,height:3,background:"rgba(255,255,255,.3)",width:`${prog}%`}}/>}
                </button>
                <div style={{fontSize:8,color:"var(--td)",fontFamily:"var(--mono)",textAlign:"center",lineHeight:1.6}}>Auto-send sends clean packets. Use field panels on each card to inject specific bits.</div>
              </div>
              <div style={{padding:"0 13px 13px",display:"flex",gap:5}}>
                <Stat label="Total" val={sent} color="var(--amber)"/>
                <Stat label="OK" val={oks} color="var(--green)"/>
                <Stat label="Err" val={errs} color="var(--red)"/>
              </div>
            </div>

            {/* COL 2: Packet Cards */}
            <div style={{background:"var(--base)",display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0}}>
              <div style={{padding:"7px 14px",background:"var(--surf)",borderBottom:"1px solid var(--bdr)",flexShrink:0,display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:".12em"}}>PACKET LIBRARY — BIT-LEVEL TEST INJECTION</span>
                <span style={{fontSize:8,color:"var(--td)",fontFamily:"var(--mono)",marginLeft:"auto"}}>Expand card → pick category tab → select value → SEND THIS PACKET</span>
              </div>
              <div style={{flex:1,overflowY:"auto",overflowX:"hidden",padding:"12px 14px",display:"flex",flexDirection:"column",gap:10,minHeight:0}}>
                {PACKETS.map(p=>{
                  const open=expandedCards.has(p.id);
                  const cats=[...new Set(p.testFields.map(f=>f.cat))];
                  const activeCat=activeCats[p.id]||cats[0]||null;
                  const visibleFields=p.testFields.filter(f=>f.cat===activeCat);
                  return(
                    <div key={p.id} style={{borderRadius:10,border:`1px solid ${open?p.color+"55":"var(--bdr)"}`,background:"var(--surf)",transition:"all .25s",flexShrink:0,boxShadow:open?`0 0 20px ${p.color}12`:"none"}}>
                      <div onClick={()=>toggleCard(p.id)} style={{padding:"12px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,background:open?`${p.color}0e`:"transparent",borderBottom:open?`1px solid ${p.color}33`:"1px solid transparent",userSelect:"none"}}>
                        <div style={{width:4,height:40,borderRadius:2,background:p.color,flexShrink:0}}/>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                            <span className="tag" style={{background:`${p.color}22`,color:p.color,border:`1px solid ${p.color}55`,fontSize:10}}>{p.label}</span>
                            <span style={{fontFamily:"var(--hd)",fontSize:15,letterSpacing:".07em",color:p.color,lineHeight:1}}>{p.name}</span>
                            {p.isEmergency&&<span className="tag" style={{background:"rgba(239,68,68,.15)",color:"#ef4444",border:"1px solid rgba(239,68,68,.4)"}}>EMERGENCY PKT</span>}
                            {p.testFields.length===0&&<span className="tag" style={{background:"var(--raised)",color:"var(--tm)",border:"1px solid var(--bdr)"}}>NO TEST FIELDS</span>}
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:12}}>
                            <span style={{fontSize:9,color:"var(--ts)",fontFamily:"var(--mono)"}}>{p.route}</span>
                            <span style={{fontSize:9,color:"var(--td)",fontFamily:"var(--mono)"}}>PKT_TYPE {p.pktType}</span>
                            {cats.length>0&&<span style={{fontSize:9,color:p.color,fontFamily:"var(--mono)",fontWeight:700}}>{p.testFields.length} fields · {cats.length} categories</span>}
                          </div>
                        </div>
                        <div style={{fontSize:8,color:"var(--tc)",fontFamily:"var(--mono)",background:"var(--raised)",padding:"3px 8px",borderRadius:4,border:"1px solid var(--bdr)",flexShrink:0,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.base.slice(0,18)}<span style={{color:"var(--td)"}}>…</span></div>
                        <div style={{fontSize:12,color:"var(--tm)",flexShrink:0,transition:"transform .25s",transform:open?"rotate(180deg)":"rotate(0deg)"}}>▼</div>
                      </div>
                      {open&&(
                        <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:10}}>
                          {p.note&&(<div style={{padding:"8px 12px",borderRadius:7,background:p.isEmergency?"rgba(239,68,68,.07)":"rgba(139,92,246,.07)",border:`1px solid ${p.isEmergency?"rgba(239,68,68,.25)":"rgba(139,92,246,.25)"}`,display:"flex",gap:10,alignItems:"flex-start"}}><span style={{fontSize:13,flexShrink:0}}>ℹ️</span><span style={{fontSize:9,color:p.isEmergency?"#fca5a5":"#ddd6fe",fontFamily:"var(--mono)",lineHeight:1.6}}>{p.note}</span></div>)}
                          {cats.length>0&&(<div style={{display:"flex",alignItems:"center",gap:6,padding:"8px 12px",borderRadius:8,background:"var(--raised)",border:"1px solid var(--bdr)"}}><span style={{fontSize:9,color:"var(--tm)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:".06em",flex:1}}>Send Mode</span>{["single","multi"].map(m=>{const isActive=getSendMode(p.id)===m;const label=m==="single"?"⚡ Single Field":"⚡⚡ Multi-Field";const desc=m==="single"?"Send one field at a time":"Combine multiple fields in one packet";return(<button key={m} onClick={e=>{e.stopPropagation();setSendMode(prev=>({...prev,[p.id]:m}));if(m==="single")clearStaged(p.id);}} style={{padding:"5px 12px",borderRadius:6,border:`1.5px solid ${isActive?p.color:"var(--bdr)"}`,background:isActive?`${p.color}20`:"transparent",color:isActive?p.color:"var(--tm)",fontSize:9,fontFamily:"var(--mono)",fontWeight:isActive?700:400,cursor:"pointer",transition:"all .15s",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}><span style={{fontWeight:700}}>{label}</span><span style={{fontSize:7,opacity:.7}}>{desc}</span></button>);})}</div>)}
                          {cats.length>0&&(<div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{cats.map(cat=>{const cm=CATS[cat]||{label:cat,icon:"•",color:"#888"};const isActive=activeCat===cat;return(<button key={cat} className="cat-tab" onClick={e=>{e.stopPropagation();setCardCat(p.id,cat);}} style={{borderColor:isActive?cm.color:"var(--bdr)",background:isActive?`${cm.color}20`:"transparent",color:isActive?cm.color:"var(--tm)"}}>{cm.icon} {cm.label}<span style={{marginLeft:5,fontSize:8,opacity:.7}}>({p.testFields.filter(f=>f.cat===cat).length})</span></button>);})}</div>)}
                          {visibleFields.map(f=>(f.presets?<PresetPanel key={f.fieldName} pkt={p} field={f} mode={getSendMode(p.id)} stagedVal={(staged[p.id]||{})[f.fieldName]?.val??null} onSend={sendField} onStage={(opt)=>stageField(p.id,f,opt)} disabled={be===false}/>:<RadioPanel key={f.fieldName} pkt={p} field={f} mode={getSendMode(p.id)} stagedVal={(staged[p.id]||{})[f.fieldName]?.val??null} onSend={sendField} onStage={(opt)=>stageField(p.id,f,opt)} disabled={be===false}/>))}
                          {getSendMode(p.id)==="multi"&&(<MultiStagePanel pkt={p} staged={staged[p.id]||{}} onClear={()=>clearStaged(p.id)} onSend={()=>sendMulti(p)} disabled={be===false}/>)}
                          <button onClick={()=>sendClean(p)} disabled={be===false} style={{padding:"7px 0",borderRadius:6,border:`1px solid ${p.color}33`,background:`${p.color}0c`,color:p.color,fontSize:10,fontFamily:"var(--mono)",fontWeight:600,cursor:"pointer",transition:"all .15s"}} onMouseEnter={e=>{e.currentTarget.style.background=`${p.color}22`;e.currentTarget.style.borderColor=`${p.color}55`;}} onMouseLeave={e=>{e.currentTarget.style.background=`${p.color}0c`;e.currentTarget.style.borderColor=`${p.color}33`;}}>SEND CLEAN PACKET — No bits injected</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* COL 3: Log */}
            <div style={{background:"var(--surf)",borderLeft:"1px solid var(--bdr)",display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0}}>
              <div style={{padding:"7px 13px",background:"var(--raised)",borderBottom:"1px solid var(--bdr)",flexShrink:0,display:"flex",alignItems:"center",gap:7}}>
                <span style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:".12em",flex:1}}>SEND LOG</span>
                {sending&&<div style={{display:"flex",alignItems:"center",gap:4}}><span className="blink" style={{color:"var(--green)",fontSize:11}}>●</span><span style={{fontSize:9,color:"var(--green)",fontFamily:"var(--mono)"}}>AUTO</span></div>}
                {Object.entries(CATS).map(([k,c])=>{const n=log.filter(e=>e.type===k||e.catLabel?.includes(c.label)).length;return n>0?(<span key={k} className="tag" style={{background:`${c.color}18`,color:c.color,border:`1px solid ${c.color}30`}}>{c.icon}{n}</span>):null;})}
                <button onClick={()=>setLog([])} style={{background:"transparent",border:"1px solid var(--bdr)",borderRadius:4,fontSize:9,padding:"2px 7px",color:"var(--tm)",cursor:"pointer",fontFamily:"var(--mono)"}} onMouseEnter={e=>{e.currentTarget.style.color="var(--red)";e.currentTarget.style.borderColor="var(--red)";}} onMouseLeave={e=>{e.currentTarget.style.color="var(--tm)";e.currentTarget.style.borderColor="var(--bdr)";}}>✕</button>
              </div>
              {last&&(<div style={{padding:"6px 13px",borderBottom:"1px solid var(--bdr)",background:`${last.color}0a`,flexShrink:0}}><div style={{fontSize:7,color:"var(--td)",fontFamily:"var(--mono)",marginBottom:3,textTransform:"uppercase",letterSpacing:".08em"}}>LAST SENT</div><div style={{display:"flex",alignItems:"center",gap:6}}><span className="tag" style={{background:`${last.color}22`,color:last.color,border:`1px solid ${last.color}44`}}>{last.label}</span><span style={{fontSize:11,color:"var(--tp)",fontWeight:500,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{last.name}</span><span style={{fontSize:8,color:"var(--td)",fontFamily:"var(--mono)",flexShrink:0}}>{(last.payload||"").slice(0,10)}…</span></div></div>)}
              <div ref={logR} style={{flex:1,overflowY:"auto",minHeight:0}}>
                {log.length===0?(
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:10,color:"var(--tm)"}}>
                    <span style={{fontSize:28}}>📤</span>
                    <span style={{fontSize:11}}>Waiting for sends...</span>
                    <span style={{fontSize:9,opacity:.6,textAlign:"center",maxWidth:200,lineHeight:1.7}}>Expand a packet card, select a category tab, pick a field value, then click SEND THIS PACKET</span>
                  </div>
                ):log.map((e,i)=>{
                  const isInj=e.type&&e.type!=="clean"&&e.type!=="info"&&e.type!=="error";
                  const isBrake=e.type==="brake";const isErr=e.type==="error";const isInfo=e.type==="info";
                  const catMeta=Object.values(CATS).find(c=>c.label===e.catLabel?.replace(/^. /,""))||null;
                  const accent=isBrake?"#fb923c":isInj&&e.fieldSev?S[e.fieldSev]?.c||"#60a5fa":"var(--td)";
                  return(
                    <div key={e.id||i} className={i===log.length-1?"slidein":""} style={{padding:"6px 12px",borderBottom:`1px solid ${isInj?"rgba(255,255,255,.04)":"rgba(255,255,255,.025)"}`,background:isInj?"rgba(255,255,255,.015)":isErr?"rgba(239,68,68,.04)":"transparent",borderLeft:`3px solid ${isInj?accent:isErr?"#ef444466":isInfo?"var(--bdr)":e.color||"var(--td)"}`}}>
                      <div style={{display:"flex",alignItems:"center",gap:5,fontFamily:"var(--mono)"}}>
                        <span style={{fontSize:8,color:"var(--td)",minWidth:54,flexShrink:0}}>{e.ts}</span>
                        {e.label&&<span className="tag" style={{background:`${e.color||"#888"}18`,color:e.color||"#888",border:`1px solid ${e.color||"#888"}33`}}>{e.label}</span>}
                        {isInj&&<span style={{fontSize:9,color:accent,fontFamily:"var(--mono)",fontWeight:700,flexShrink:0}}>{isBrake?"🛑":catMeta?.icon||"→"}</span>}
                        <span style={{fontSize:10,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:isInj?accent:isErr?"#ef4444":isInfo?"var(--tm)":e.color||"var(--ts)",fontWeight:isInj?700:400}}>{isInj?e.fieldName+" = "+e.fieldVal:e.name}</span>
                        {typeof e.subs==="number"&&<span className="tag" style={{background:e.subs>0?"rgba(16,185,129,.12)":"var(--raised)",color:e.subs>0?"var(--green)":"var(--td)",border:`1px solid ${e.subs>0?"rgba(16,185,129,.3)":"var(--bdr)"}`}}>{e.subs}s</span>}
                      </div>
                      {isInj&&(<div style={{paddingLeft:59,marginTop:3,display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}><span className="tag" style={{background:`${accent}18`,color:accent,border:`1px solid ${accent}44`}}>{e.catLabel||e.fieldName}</span><span style={{fontSize:9,color:accent,fontFamily:"var(--mono)",fontWeight:600,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.fieldText}</span><span style={{fontSize:8,color:"var(--td)",fontFamily:"var(--mono)",flexShrink:0}}>bit {e.fieldBit}  val={e.fieldVal}</span></div>)}
                      {e.hex&&!isInfo&&(<div style={{paddingLeft:59,marginTop:2,display:"flex",gap:5,alignItems:"center"}}><span style={{fontSize:7,color:"var(--td)",fontFamily:"var(--mono)"}}>HEX</span><span style={{fontSize:8,letterSpacing:".04em",color:"var(--td)",fontFamily:"var(--mono)"}}>{(e.hex.match(/.{1,2}/g)||[]).join(" ")}…</span></div>)}
                    </div>
                  );
                })}
              </div>
              <div style={{padding:"5px 13px",borderTop:"1px solid var(--bdr)",fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",background:"var(--ftbg)",flexShrink:0,display:"flex",alignItems:"center",gap:8}}>
                <span style={{color:"var(--green)"}}>→ PINJ LIVE</span>
                <div style={{marginLeft:"auto",display:"flex",gap:5,alignItems:"center"}}>
                  {PACKETS.map(p=>{const n=log.filter(e=>e.label===p.label).length;return n>0?(<span key={p.id} className="tag" style={{background:`${p.color}15`,color:p.color,border:`1px solid ${p.color}30`}}>{p.label}:{n}</span>):null;})}
                  <span style={{color:"var(--td)"}}>{log.length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}