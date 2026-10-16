import { useState, useRef, useEffect, useCallback, useMemo } from "react";

import LogReplay from "./LogReplay";
const INGEST_URL = "http://localhost:8000/ingest";
const HEALTH_URL = "http://localhost:8000/health";

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
        <button onClick={e=>{e.stopPropagation();onSend();}} disabled={disabled||!hasAny} className={hasAny?"armed":""} style={{width:"100%",padding:"10px 0",borderRadius:8,border:`2px solid ${hasAny?accentColor:"var(--bdr)"}`,background:hasAny?`linear-gradient(135deg,${accentColor},${accentColor}bb)`:"var(--raised)",color:hasAny?"#fff":"var(--td)",fontSize:12,fontFamily:"var(--mono)",fontWeight:900,letterSpacing:".1em",cursor:hasAny?"pointer":"not-allowed",transition:"all .2s",boxShadow:hasAny?`0 0 20px ${accentColor}44`:"none"}}>{hasAny?`⚡ TRANSMIT ${entries.length}-FIELD PACKET → DECODEX LIVE`:"Stage fields above then transmit"}</button>
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

/* ══════════════════════════════════════════════════════════════
   DMI COLOURS (Table B.2 Annexure-B)
══════════════════════════════════════════════════════════════ */
const DC={
  WHT:"#FFFFFF",BLK:"#000000",LGY:"#808080",GRY:"#C0C0C0",
  LBL:"#008BCE",YLW:"#DFDF00",LOR:"#FFA500",ORG:"#FF8040",
  BRD:"#FF0000",LGR:"#80FF00",GRN:"#00FF00",DGR:"#008000",
};

/* Mode metadata */
const MODE_INFO={
  SB:{name:"Stand By",color:"#808080",maxSpeed:0},
  SR:{name:"Staff Responsible",color:"#DFDF00",maxSpeed:120},
  LS:{name:"Limited Supervision",color:"#008BCE",maxSpeed:100},
  FS:{name:"Full Supervision",color:"#00FF00",maxSpeed:200},
  OV:{name:"Override",color:"#FF8040",maxSpeed:30},
  OS:{name:"On Sight",color:"#FFA500",maxSpeed:25},
  TR:{name:"Trip",color:"#FF0000",maxSpeed:0},
  PT:{name:"Post Trip",color:"#FF8040",maxSpeed:0},
  RV:{name:"Reverse",color:"#80FF00",maxSpeed:25},
  SH:{name:"Shunt",color:"#008BCE",maxSpeed:15},
  NL:{name:"Non Leading",color:"#808080",maxSpeed:200},
  SF:{name:"System Failure",color:"#FF0000",maxSpeed:0},
  IS:{name:"Isolation",color:"#808080",maxSpeed:200},
};

const LOCO_MODE_NUM={SB:1,SR:2,LS:3,FS:4,OV:5,OS:6,TR:7,PT:8,RV:9,SH:10,NL:11,SF:12,IS:13};

const SIG_ASPECTS={
  OFF:{lamps:[false,false,false,false],name:"No Signal"},
  RED:{lamps:[false,false,false,true],name:"Red"},
  YELLOW:{lamps:[false,false,true,false],name:"Yellow"},
  DYELLOW:{lamps:[false,true,true,false],name:"Double Yellow"},
  GREEN:{lamps:[true,false,false,false],name:"Green"},
  CALLON:{lamps:[false,false,false,true],name:"Red+Calling-On",callon:true},
};

const SOFTKEYS=["P_TRP","REV","OVRD","SHNT","MBT","SR","CONFIG","","CNFM","INFO"];

/* ── DMI log scale helpers ── */
function logS(v,max,h){if(v<=0)return 0;return(Math.log10(Math.min(v,max)+1)/Math.log10(max+1))*h;}

/* ── Speedometer (spec-accurate B4.4.5) ── */
function DMISpeedometer({speed=0,permitted=100,brakeActive=false,size=310}){
  const cx=size/2, cy=size/2+4;
  const oR=size*.47;   // outer rim
  const aR=size*.435;  // inner edge of colour arc band
  const dR=size*.40;   // tick ring (outer edge of ticks)
  const valR=size*.092; // small circle just around speed digits
  const toA=s=>-149+(Math.min(s,250)/250)*298;
  const toRad=a=>((a-90)*Math.PI)/180;
  const cur=Math.min(speed,250), per=Math.min(permitted,250);
  const overspeed=cur>per;
  const arcC=overspeed?(brakeActive?DC.BRD:DC.LOR):DC.LGR;
  const buildBand=(s1,s2,r,r2)=>{
    const a1=toRad(toA(s1)),a2=toRad(toA(s2));
    const x1=cx+r*Math.cos(a1),y1=cy+r*Math.sin(a1);
    const x2=cx+r*Math.cos(a2),y2=cy+r*Math.sin(a2);
    const x3=cx+r2*Math.cos(a2),y3=cy+r2*Math.sin(a2);
    const x4=cx+r2*Math.cos(a1),y4=cy+r2*Math.sin(a1);
    const large=Math.abs(s2-s1)>125?1:0;
    return `M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${r2} ${r2} 0 ${large} 0 ${x4} ${y4} Z`;
  };
  const nA=toRad(toA(cur));
  const nC=overspeed?(brakeActive?DC.BRD:DC.LOR):DC.WHT;
  /* needle tip near ticks, base stops before the value circle */
  const tipX=cx+(dR-size*.01)*Math.cos(nA), tipY=cy+(dR-size*.01)*Math.sin(nA);
  const baseX=cx+(valR+size*.01)*Math.cos(nA), baseY=cy+(valR+size*.01)*Math.sin(nA);
  const pA=nA+Math.PI/2, bw=size*.011;
  const ticks=[];
  for(let i=0;i<=125;i++){
    const sv=i*2, ar=toRad(toA(sv));
    const tl=i%10===0?size*.046:i%5===0?size*.032:size*.018;
    const tw=i%10===0?2.5:i%5===0?2:1;
    const isBig=i%10===0;
    ticks.push({
      x1:cx+dR*Math.cos(ar), y1:cy+dR*Math.sin(ar),
      x2:cx+(dR-tl)*Math.cos(ar), y2:cy+(dR-tl)*Math.sin(ar),
      tw,
      lx:isBig?cx+(dR-tl-size*.048)*Math.cos(ar):0,
      ly:isBig?cy+(dR-tl-size*.048)*Math.sin(ar):0,
      lv:isBig?sv:null,
    });
  }
  return(
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{display:"block"}}>
      {/* Background disc — no outer ring */}
      <circle cx={cx} cy={cy} r={oR} fill="#050505"/>
      {/* Speed arc band */}
      {per>0&&<path d={buildBand(0,per,oR,aR)} fill={overspeed?arcC:DC.LGR} opacity={overspeed?0.85:0.95}/>}
      {overspeed&&<path d={buildBand(per,cur,oR,aR)} fill={arcC} opacity={0.95}/>}
      {/* Tick marks + labels */}
      {ticks.map((t,i)=>(
        <g key={i}>
          <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={DC.WHT} strokeWidth={t.tw} strokeLinecap="round"/>
          {t.lv!==null&&<text x={t.lx} y={t.ly} textAnchor="middle" dominantBaseline="central"
            fontSize={size*.038} fontWeight="bold" fill={DC.WHT} fontFamily="Helvetica,sans-serif">{t.lv}</text>}
        </g>
      ))}
      {/* Needle */}
      <polygon
        points={`${tipX},${tipY} ${cx+bw*Math.cos(pA)},${cy+bw*Math.sin(pA)} ${cx-bw*Math.cos(pA)},${cy-bw*Math.sin(pA)}`}
        fill={nC}/>
      <line x1={baseX} y1={baseY} x2={tipX} y2={tipY} stroke={nC} strokeWidth={size*.009} strokeLinecap="round"/>
      {/* White filled circle around speed value — black text inside */}
      <circle cx={cx} cy={cy} r={valR} fill={DC.WHT}/>
      <text x={cx} y={cy+size*.005} textAnchor="middle" dominantBaseline="central"
        fontSize={size*.072} fontWeight="bold" fill={DC.BLK} fontFamily="Helvetica,sans-serif">
        {Math.round(cur)}
      </text>
      {/* Hub centre pin */}
      <circle cx={cx} cy={cy} r={size*.016} fill={nC}/>
    </svg>
  );
}

/* ── Target Distance Bar (Region A) ── */
function TargetBar({dist=null,type="EOA"}){
  const W=92,H=388,usable=H*.8,top=H*.07;
  const mY=v=>top+usable*(1-logS(v,2000,1));
  if(!dist) return <div style={{width:W,height:H,background:"black",flexShrink:0}}/>;
  const barT=mY(dist),barH=Math.max(mY(0)-barT,2);
  return(
    <div style={{width:W,height:H,background:"black",position:"relative",flexShrink:0}}>
      <div style={{position:"absolute",top:6,left:0,right:0,textAlign:"center",fontSize:8,color:DC.WHT,fontFamily:"Helvetica,sans-serif",fontWeight:"bold",lineHeight:1.2}}>{type}<br/>Target<br/>Dist</div>
      {[2000,1000,500,250,0].map(v=>(
        <div key={v}>
          <div style={{position:"absolute",top:mY(v)-6,left:0,width:31,textAlign:"right",fontSize:7,color:DC.WHT,fontFamily:"Helvetica,sans-serif"}}>{v||"0"}</div>
          <div style={{position:"absolute",top:mY(v),left:31,width:30,height:1,background:DC.WHT}}/>
        </div>
      ))}
      <div style={{position:"absolute",left:35,top:barT,width:22,height:barH,background:DC.LOR}}/>
      <div style={{position:"absolute",bottom:6,left:0,right:0,textAlign:"center",fontSize:10,fontWeight:"bold",color:DC.WHT,fontFamily:"Helvetica,sans-serif"}}>{String(Math.round(dist)).padStart(4,"0")} m</div>
    </div>
  );
}

/* ── Movement Authority Bar (Region C) ── */
function MABar({ma=0}){
  const W=112,H=388,usable=H*.8,top=H*.07;
  const mY=v=>{if(v>=3000)return top;if(v<=0)return top+usable;return top+usable*(1-logS(v,3000,1));};
  const barT=mY(Math.min(ma,3000)),barH=Math.max(mY(0)-barT,2);
  const labeled=[3000,2000,1000,500,250,0];
  return(
    <div style={{width:W,height:H,background:"black",position:"relative",flexShrink:0}}>
      <div style={{position:"absolute",top:6,left:0,right:0,textAlign:"center",fontSize:8,color:DC.WHT,fontFamily:"Helvetica,sans-serif"}}>Mov.<br/>Auth.</div>
      {[3000,2000,1000,500,250,100,0].map(v=>(<div key={v} style={{position:"absolute",top:mY(v),left:40,width:32,height:1,background:DC.WHT}}/>))}
      {labeled.map(v=>(<div key={`l${v}`} style={{position:"absolute",top:mY(v)-6,left:0,width:38,textAlign:"right",fontSize:7,color:DC.WHT,fontFamily:"Helvetica,sans-serif"}}>{ma>=3000&&v===3000?"+++":v}</div>))}
      <div style={{position:"absolute",left:42,top:barT,width:27,height:barH,background:DC.LBL}}/>
      <div style={{position:"absolute",bottom:6,left:0,right:0,textAlign:"center",fontSize:10,fontWeight:"bold",color:DC.WHT,fontFamily:"Helvetica,sans-serif"}}>{ma>=3000?"+++++":String(Math.min(ma,99999)).padStart(5,"0")}m</div>
    </div>
  );
}

/* ── Signal Aspect (Region D) ── */
function SigAspect({aspect="OFF",dir="DN",sigName="Home",sigDist=null}){
  const asp=SIG_ASPECTS[aspect]||SIG_ASPECTS.OFF;
  const lampC=[DC.YLW,DC.GRN,DC.YLW,DC.BRD];
  const lampA=[aspect==="DYELLOW",aspect==="GREEN",aspect==="YELLOW"||aspect==="DYELLOW",aspect==="RED"||aspect==="CALLON"];
  const cx=114,lR=20,gap=7;
  const lY=[30,30+lR*2+gap,30+(lR*2+gap)*2,30+(lR*2+gap)*3];
  return(
    <div style={{width:228,height:419,background:"black",position:"relative",flexShrink:0}}>
      {aspect!=="OFF"&&(
        <svg width={228} height={360} style={{position:"absolute",top:0,left:0}}>
          <line x1={cx-18} y1={28} x2={cx+18} y2={5} stroke={DC.GRY} strokeWidth={1}/>
          <line x1={cx-18} y1={lY[3]+lR*2+8} x2={cx+18} y2={lY[3]+lR*2+28} stroke={DC.GRY} strokeWidth={1}/>
          {lY.map((ly,i)=>(
            <g key={i}>
              <circle cx={cx} cy={ly+lR} r={lR} fill={lampA[i]?lampC[i]:"#111"} stroke={DC.WHT} strokeWidth={2}/>
              {lampA[i]&&<circle cx={cx} cy={ly+lR} r={lR+4} fill="none" stroke={lampC[i]} strokeWidth={1} opacity={0.4}/>}
            </g>
          ))}
          {asp.callon&&<><circle cx={cx} cy={lY[3]+lR*2+14} r={12} fill={DC.WHT}/><text x={cx} y={lY[3]+lR*2+18} textAnchor="middle" fontSize={9} fontFamily="Helvetica,sans-serif" fill={DC.BLK}>C</text></>}
        </svg>
      )}
      <div style={{position:"absolute",bottom:50,left:0,right:0,textAlign:"center",fontSize:11,fontWeight:"bold",color:DC.WHT,fontFamily:"Helvetica,sans-serif"}}>{sigDist!==null?String(sigDist).padStart(4,"0")+" m":""}</div>
      <div style={{position:"absolute",bottom:10,left:4,right:4,textAlign:"center",fontSize:9,color:DC.ORG,fontFamily:"Helvetica,sans-serif"}}>{dir} {sigName}</div>
    </div>
  );
}

/* ── Mode Symbol (Region B10) ── */
function ModeSym({mode="SB",size=34}){
  const m=MODE_INFO[mode]||MODE_INFO.SB,c=m.color,cx=size/2,cy=size/2,r=size*.38;
  return(
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {mode==="SF"&&<polygon points={`${cx},${cy-r} ${cx+r},${cy+r} ${cx-r},${cy+r}`} fill={DC.BRD}/>}
      {mode==="FS"&&<circle cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeWidth={2}/>}
      {mode==="TR"&&<><circle cx={cx} cy={cy-r*.3} r={r*.35} fill={DC.BRD}/><circle cx={cx} cy={cy+r*.45} r={r*.35} fill={DC.BRD}/></>}
      {mode==="OS"&&<polygon points={`${cx},${cy-r} ${cx+r},${cy+r} ${cx-r},${cy+r}`} fill="none" stroke={c} strokeWidth={2}/>}
      {mode==="SR"&&<><line x1={cx-r} y1={cy-r} x2={cx+r} y2={cy+r} stroke={c} strokeWidth={2}/><line x1={cx+r} y1={cy-r} x2={cx-r} y2={cy+r} stroke={c} strokeWidth={2}/><rect x={cx-r} y={cy-r} width={r*2} height={r*2} fill="none" stroke={c} strokeWidth={1}/></>}
      {!["SF","FS","TR","OS","SR"].includes(mode)&&<text x={cx} y={cy+4} textAnchor="middle" fontSize={size*.28} fill={c} fontFamily="Helvetica,sans-serif" fontWeight="bold">{mode}</text>}
    </svg>
  );
}

/* ── RF Signal (Region J) ── */
function RFSig({bars=5,hole=false}){
  return(
    <svg width={133} height={62}>
      {!hole?(<>
        <line x1={22} y1={8} x2={38} y2={50} stroke={DC.WHT} strokeWidth={2}/>
        <line x1={22} y1={8} x2={6} y2={50} stroke={DC.WHT} strokeWidth={2}/>
        <line x1={22} y1={8} x2={22} y2={2} stroke={DC.WHT} strokeWidth={2}/>
        <text x={6} y={60} fontSize={8} fill={DC.WHT} fontFamily="Helvetica,sans-serif">RF</text>
        {[15,20,25,30,35].map((h,i)=><rect key={i} x={50+i*9} y={52-h} width={4} height={h} fill={i<bars?DC.GRN:"#333"}/>)}
      </>):(<>
        <line x1={8} y1={8} x2={40} y2={54} stroke={DC.BRD} strokeWidth={3}/>
        <line x1={40} y1={8} x2={8} y2={54} stroke={DC.BRD} strokeWidth={3}/>
        <text x={50} y={35} fontSize={8} fill={DC.BRD} fontFamily="Helvetica,sans-serif">NO RF</text>
      </>)}
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════
   PACKET BUILDERS from DMI state
══════════════════════════════════════════════════════════════ */
/* ── C.4.6 Access Request (PKT_TYPE=13) bit layout (verified against decoder):
     0-3  PKT_TYPE(4)  4-10  PKT_LENGTH(7)  11-27 FRAME_NUM(17)
     28-47 SOURCE_LOCO_ID(20)  48-50 SOURCE_LOCO_VER(3)
     51-73 ABS_LOCO_LOC(23)   74-84 TRAIN_LENGTH(11)
     85-93 TRAIN_SPEED(9)  94-95 MOVEMENT_DIR(2)
     96-98 EMERGENCY_STATUS(3)  99-102 LOCO_MODE(4) ── */
function buildC46pkt(st){
  let h="D3900C103039407CFA80C8C9040413501800000000000000006B293B76";
  h=injectBits(h,28,20,Math.min(Math.max(0,st.locoId),999999)); // SOURCE_LOCO_ID
  h=injectBits(h,51,23,Math.min(Math.round(st.loc*1000),8388606)); // ABS_LOCO_LOC
  h=injectBits(h,74,11,Math.min(st.trainLen,2047));                // TRAIN_LENGTH
  h=injectBits(h,85,9,Math.min(st.speed,511));                     // TRAIN_SPEED
  h=injectBits(h,94,2,st.dir==="DN"?2:1);                         // MOVEMENT_DIR
  h=injectBits(h,96,3,st.emg);                                     // EMERGENCY_STATUS
  h=injectBits(h,99,4,LOCO_MODE_NUM[st.mode]||1);                  // LOCO_MODE
  return h;
}
/* ── C.4.3 L2S Regular (PKT_TYPE=10) bit layout (verified against decoder):
     0-3  PKT_TYPE(4)  4-10  PKT_LENGTH(7)  11-27 FRAME_NUM(17)
     28-47 SOURCE_LOCO_ID(20)  48-50 SOURCE_LOCO_VER(3)
     51-73 ABS_LOCO_LOC(23)   74-82 L_DOUBTOVER(9)  83-91 L_DOUBTUNDER(9)
     92-93 TRAIN_INT(2)  94-104 TRAIN_LENGTH(11)
     105-113 TRAIN_SPEED(9)  114-115 MOVEMENT_DIR(2)
     116-118 EMERGENCY_STATUS(3)  119-122 LOCO_MODE(4)
     146-148 BRAKE_APPLIED(3)  155 SIG_OVERRIDE(1)  156-159 INFO_ACK(4) ── */
function buildC43pkt(st){
  let h="A38A479001F841008D8000000C80104B981F40000011AD67DD2E14CF7A";
  h=injectBits(h,28,20,Math.min(Math.max(0,st.locoId),999999)); // SOURCE_LOCO_ID
  h=injectBits(h,51,23,Math.min(Math.round(st.loc*1000),8388606)); // ABS_LOCO_LOC
  h=injectBits(h,94,11,Math.min(st.trainLen,2047));               // TRAIN_LENGTH
  h=injectBits(h,105,9,Math.min(st.speed,511));                   // TRAIN_SPEED
  h=injectBits(h,114,2,st.dir==="DN"?2:1);                       // MOVEMENT_DIR
  h=injectBits(h,116,3,st.emg);                                   // EMERGENCY_STATUS
  h=injectBits(h,119,4,LOCO_MODE_NUM[st.mode]||4);                // LOCO_MODE
  h=injectBits(h,146,3,st.brake);                                 // BRAKE_APPLIED
  return h;
}

/* ── C.4.2 Station→Loco Regular  (PKT_TYPE=9) — full bit-accurate builder
   Constructs header + MA + SSP + Gradient + LC Gate + Turnout + TLI sub-packets.
   No base-hex injection — built bit-by-bit to match the JS decoder exactly.
   Ref: RDSO/SPN/196/2020 Annexure-C §C.4.2  ── */
function buildC42pkt(st) {
  /* st = { aspCode, authSpeedRaw, apprSigDist, maWRT, stnId, refRFID, destLocoId, frameNum,
            ssp[], grad[], lc[], turnouts[], tliTags[] }  */

  /* ── Bit-string helpers ── */
  const bN = (val,n) => (val>>>0).toString(2).padStart(64,'0').slice(-n);
  const bits2hex = bits => {
    let s=''; const rem=bits.length%8; const padded=rem?bits+'0'.repeat(8-rem):bits;
    for(let i=0;i<padded.length;i+=8) s+=parseInt(padded.slice(i,i+8),2).toString(16).toUpperCase().padStart(2,'0');
    return s;
  };

  /* ── MA sub-packet (type=0): 4+7+81 = 92 bits ── */
  const maBody = [
    bN(0,4),          // FRAME_OFFSET
    bN(0,4),          // DEST_LOCO_SOS
    bN(1,2),          // TRAIN_SECTION_TYPE=1 (Absolute Block)
    bN(0,17),         // CUR_SIG_INFO
    bN(st.aspCode,6), // CUR_SIG_ASPECT
    bN(0,6),          // NEXT_SIG_ASPECT
    bN(Math.min(st.apprSigDist,32767),15), // APPR_SIG_DIST
    bN(2,2),          // AUTHORITY_TYPE=2 (FS)
    bN(st.authSpeedRaw,6), // AUTHORIZED_SPEED (raw, ×5=kmph)
    bN(Math.min(st.maWRT,65535),16), // MA_W_R_T_SIG
    bN(0,1),          // REQ_SHORTEN_MA
    bN(0,1),          // TRN_LEN_INFO_STS
    bN(0,1),          // NEXT_STN_COMM
  ].join('');         // 4+4+2+17+6+6+15+2+6+16+1+1+1 = 81 bits
  const maSub = bN(0,4) + bN(10,7) + maBody; // type(4)+len_field=10(7)+81bits

  /* ── SSP sub-packet (type=1) ── */
  const sspEntries = st.ssp || [];
  let sspBody = bN(sspEntries.length,5);
  for(const e of sspEntries) sspBody += bN(e.dist,15)+bN(0,1)+bN(Math.min(50,Math.max(1,Math.round(e.speed/5))),6);
  const sspLenField = Math.max(0, Math.ceil(sspBody.length/8)-1);
  const sspSub = bN(1,4)+bN(sspLenField,7)+sspBody;

  /* ── Gradient sub-packet (type=2) ── */
  const gradEntries = st.grad || [];
  let gradBody = bN(gradEntries.length,5);
  for(const e of gradEntries) gradBody += bN(e.dist,15)+bN(e.isUp?1:0,1)+bN(e.grad||0,5);
  const gradLenField = Math.max(0, Math.ceil(gradBody.length/8)-1);
  const gradSub = bN(2,4)+bN(gradLenField,7)+gradBody;

  /* ── LC Gate sub-packet (type=3) ── */
  const lcEntries = st.lc || [];
  let lcBody = bN(lcEntries.length,5);
  for(const e of lcEntries) lcBody += bN(e.dist,15)+bN(e.id%1023,10)+bN(0,3)+bN(e.unmanned?1:0,1)+bN(1,3)+bN(0,1)+bN(0,2);
  const lcLenField = Math.max(0, Math.ceil(lcBody.length/8)-1);
  const lcSub = bN(3,4)+bN(lcLenField,7)+lcBody;

  /* ── Turnout sub-packet (type=4) ── */
  const toEntries = st.turnouts || [];
  let toBody = bN(Math.min(toEntries.length,3),2);
  for(const e of toEntries) toBody += bN(Math.min(18,Math.max(0,Math.round(e.speed/5))),5)+bN(e.dist,15)+bN(e.relDist||0,12);
  const toLenField = Math.max(0, Math.ceil(toBody.length/8)-1);
  const toSub = bN(4,4)+bN(toLenField,7)+toBody;

  /* ── TLI sub-packet (type=5) ── */
  const tliEntries = st.tliTags || [];
  let tliBody = bN(1,4)+bN(tliEntries.length,6); // DIST_DUP_TAG=1 + CNT
  for(const e of tliEntries) tliBody += bN(Math.min(e.dist,2047),11)+bN(e.id%1023,10)+bN(0,1);
  tliBody += bN(0,1)+bN(0,3); // ABS_LOC_RESET + ADJ_LINE_CNT
  const tliLenField = Math.max(0, Math.ceil(tliBody.length/8)-1);
  const tliSub = bN(5,4)+bN(tliLenField,7)+tliBody;

  /* ── Assemble header ── */
  const fn = st.frameNum || 44535;
  const stnId = st.stnId || 431;
  const refRFID = st.refRFID || 0;
  const destLoco = st.destLocoId || 0;
  const hdr = [
    bN(fn,17),          // FRAME_NUM
    bN(stnId,16),       // SOURCE_STN_ID
    bN(2,3),            // SOURCE_STN_VER=2
    bN(destLoco,20),    // DEST_LOCO_ID
    bN(3,4),            // REF_PROF_ID
    bN(refRFID,10),     // LAST_REF_RFID
    bN(0,15),           // DIST_PKT_START=0
    bN(1,2),            // PKT_DIR=1 (Nominal)
    bN(0,3),            // Padding
  ].join('');

  /* MAC+CRC placeholder (8 bytes = 64 bits) */
  const macCrc = bN(0,64);

  /* ── Concatenate all sub-packets ── */
  const allSubs = maSub + sspSub + gradSub + lcSub + toSub + tliSub + macCrc;

  /* PKT_LENGTH field = total bytes after type field */
  const totalPayload = hdr + allSubs;
  const pktLenBytes = Math.ceil(totalPayload.length / 8) + 1; // +1 for rounding safety

  const full = bN(9,4) + bN(pktLenBytes,10) + totalPayload;
  return bits2hex(full);
}

/* ══════════════════════════════════════════════════════════════
   DMI LOCO SIMULATOR PAGE
   Embedded inside PacketSimulator — shown when page==="dmi"
══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   REGION H — System Messages (Annexure-B Table B4.7.3)
══════════════════════════════════════════════════════════════ */
const H_MSGS = [
  "","System Fault, Isolate or Restart KAVACH",
  "Ack Block Stop, SOS Generates in 15 s",
  "EB Bypassed (EB Cock Closed), No Traction",
  "Train Tripped, Select P_Trip",
  "Brake Applied, Dead End Detected",
  "Standstill Protection, Brake Applied",
  "Rollback Protection, Brake Applied",
  "REV Movement Not Allowed, Use REV mode",
  "Stand By mode- CAB input is not Active",
  "Ack SR mode, KAVACH Territory",
  "Ack SR mode, Station Radio Comm Fail",
  "Ack SR Mode, No Track Profile Info",
  "Ack SR mode, Tags missing",
  "Ack SR mode, Direction Unknown",
  "Ack SR mode, GPS Fail",
  "Ack LS mode, Station Radio Comm Fail",
  "Ack SR mode, TSR Link Fail",
  "Head On Collision with Loco XXXXX in YYYYm",
  "Rear End Collision with Loco XXXXX in YYYYm",
  "Override selected, Pass Signal in XXXs",
  "Reverse Mode Expires in XXXXm or YYYs",
  "Manned LC Gate XXXX in YYYYm",
  "Unmanned LC Gate XXXX in YYYYm",
  "LS mode Waiting for Station Radio Comm",
  "LS mode Waiting for Track Profile Info",
  "Both Leading & Non-leading Inputs are Active",
  "Train Length Computation in Progress",
  "Train Length Computation Success (XXXXm)",
  "Train Length Computation Fail (XXXXm)",
  "Train Length Computation Aborted",
  "TurnOut in XXXXm with Speed Limit YYYkmph",
  "TSR in XXXXm with Speed Limit YYYkmph",
  "PSR in XXXXm with Speed Limit YYYkmph",
  "End of Authority in XXXXm",
  "KAVACH Territory Entry",
  "System Self Test in Progress",
  "System Self Test Success",
  "System Self Test Fail – XXXX",
  "Brakes Test Waiting for MR X.YY(X.YY)Kg/cm²",
  "Brakes Test Waiting for BP X.YY(X.YY)Kg/cm²",
  "Brakes Test NSB Applied, BP-X.YYKg/cm²",
  "Brakes Test FSB Applied, BP-X.YYKg/cm²",
  "Brakes Test EB Applied, BP-X.YYKg/cm²",
  "Brakes Test LEB Applied, BC-X.YYKg/cm²",
  "Brakes Testing Success",
  "Brakes Testing Fail (NSB,FSB,EB)",
  "Brakes Test Fail, Press ACK for Retesting",
  "Select Train Config, Press 'CONFIG' Button",
  "Select Staff Responsible or Shunt Mode",
  "Approaching Radio Hole in XXXX m",
  "ACK OS Mode",
  "Train is in FM Zone, Normalize the Reverser",
  "SR/SH Mode- ETCS –ETCS Territory Entry",
  "FS Mode- ETCS –ETCS Full Supervision Mode",
  "ACK SR Mode – ETCS Territory Exit",
  "Ballise Default telegram received",
  "Waiting for Traction Command",
  "Traction cut-off Command fail",
  "Fouling Mark Entry",
  "Fouling Mark Clear",
  "Neutral Section approaching in XXX m",
  "Braking system malfunction",
  "No Forward Dir in REV mode",
  "ACK SR Mode - SR Authorization Received",
  "ACK SR Mode - Slip/Skid Detected",
  "ACK SR mode- Foreign Tag Detected",
  "Ack for SR mode - Odo Error detected",
  "Brake Applied- Shunting limits exceeded",
  "Brake Applied- Station General SoS",
  "Brake Applied-SPAD detected",
];

/* ══════════════════════════════════════════════════════════════
   REGION I — Context Messages (Annexure-B Table B4.7)
══════════════════════════════════════════════════════════════ */
const I_MSGS = [
  "","SOS – Self Loco (Manual)",
  "SOS – Self Loco (Stopped in Block section)",
  "SOS – Self Loco (Train Parted)",
  "SOS – From Loco XXXXXX (Manual)",
  "SOS – From Loco XXXXXX (Stopped in Block section)",
  "SOS – From Loco XXXXXX (Train Parted)",
  "SOS – From Station XXXXX (SOS to All Locos)",
  "SOS – From Station XXXXX (SOS to This Loco)",
  "Over Speed, Please Reduce Speed",
  "Brake Applied, Speed Limit Exceeded",
  "FSB will be applied in YYYS",
  "EB will be applied in YYYS",
  "BIU Isolated",
  "XXXXXXX Train Type selected",
];

/* ══════════════════════════════════════════════════════════════
   DMI PAGE  — Redesigned layout:
   ┌──────────────────────────────┬──────────────────────────┐
   │  DMI 800×550                 │  RIGHT PANEL (controls)  │
   │  ┌────────────────────────┐  │  ┌── 🚆 LOCO TX ───────┐│
   │  │  Regions A B C D       │  │  │ mode / emg / speed  ││
   │  │  E F G / H I / J K     │  │  │ interval / auto/send││
   │  └────────────────────────┘  │  └────────────────────┘│
   │  ┌── PACKET LOG (horiz) ──┐  │  ┌── 📡 STATION TX ───┐│
   │  │ scrollable hex strip   │  │  │ MA / profile / auth ││
   │  └────────────────────────┘  │  │ aspect / presets    ││
   └──────────────────────────────┘  └────────────────────┘│
══════════════════════════════════════════════════════════════ */
function DMIPage({be}){

  /* ── Loco state ─────────────────────────────────────────── */
  const [speed,    setSpeed]    = useState(0);
  const [tgtSpd,   setTgtSpd]   = useState(0);
  const [mode,     setMode]     = useState("SB");
  const [locoId,   setLocoId]   = useState("188423");
  const [loc,      setLoc]      = useState(0);
  const [trainLen, setTrainLen] = useState(400);
  const [dir,      setDir]      = useState("DN");
  const [emg,      setEmg]      = useState(0);
  const [brakeActive,setBrakeActive]=useState(false);
  const [rfBars,   setRfBars]   = useState(5);
  const [radioHole,setRadioHole]= useState(false);
  const [tgtDist,  setTgtDist]  = useState(null);
  const [tgtType,  setTgtType]  = useState("EOA");
  const [dc,       setDc]       = useState(0.35);
  const [msgH,     setMsgH]     = useState("");
  const [msgI,     setMsgI]     = useState("");
  const [aKey,     setAKey]     = useState(null);

  /* ── Station (MA grant) ─────────────────────────────────── */
  const [stMA,    setStMA]    = useState(0);
  const [stProf,  setStProf]  = useState(0);
  const [stAuth,  setStAuth]  = useState(0);
  const [stAspect,setStAspect]= useState("OFF");
  const [stSigD,  setStSigD]  = useState(0);
  const [stDir,   setStDir]   = useState("DN");
  const [stSigN,  setStSigN]  = useState("DN Home");

  /* ── TX controls ─────────────────────────────────────────── */
  const [pktType,  setPktType]  = useState("both");
  const [locoMs,   setLocoMs]   = useState(1000);
  const [locoAuto, setLocoAuto] = useState(false);
  const [locoSent, setLocoSent] = useState(0);
  const [stMs,     setStMs]     = useState(2000);
  const [stAuto,   setStAuto]   = useState(false);
  const [stSent,   setStSent]   = useState(0);

  /* ── Packet log + sim ────────────────────────────────────── */
  const [pktLog,     setPktLog]     = useState([]);
  const [simRunning, setSimRunning] = useState(false);

  /* ── Stable refs (never stale inside setInterval) ────────── */
  const logRef   = useRef(null);
  const simRef   = useRef(null);
  const locoRef  = useRef(null);
  const stRef    = useRef(null);

  /* Mirror every piece of state that send functions need into a ref */
  const R = useRef({
    speed:0, mode:"SB", loc:0, trainLen:400, dir:"DN", emg:0, brake:0,
    stMA:0, stAuth:0, stAspect:"OFF", refRFID:361,
    pktType:"both", locoId:"188423",
    locoMs:1000, stMs:2000,
  });
  /* Keep R.current in sync — speed is updated directly at each setState call site */
  useEffect(()=>{ R.current.mode=mode; },[mode]);
  useEffect(()=>{ R.current.loc=loc; },[loc]);
  useEffect(()=>{ R.current.trainLen=trainLen; },[trainLen]);
  useEffect(()=>{ R.current.dir=dir; },[dir]);
  useEffect(()=>{ R.current.emg=emg; },[emg]);
  useEffect(()=>{ R.current.stMA=stMA; },[stMA]);
  useEffect(()=>{ R.current.stAuth=stAuth; },[stAuth]);
  useEffect(()=>{ R.current.stAspect=stAspect; },[stAspect]);
  useEffect(()=>{ R.current.pktType=pktType; },[pktType]);
  useEffect(()=>{ R.current.locoId=locoId; },[locoId]);
  useEffect(()=>{ R.current.locoMs=locoMs; },[locoMs]);
  useEffect(()=>{ R.current.stMs=stMs; },[stMs]);

  /* ── Derived ─────────────────────────────────────────────── */
  const maOpen    = stMA>0 && stProf>0;
  const brakeCode = brakeActive?(speed>stAuth+10?4:speed>stAuth+5?3:2):0;
  const permitted = stAuth;
  const modeInfo  = MODE_INFO[mode]||MODE_INFO.SB;
  useEffect(()=>{ R.current.brake=brakeCode; },[brakeCode]);

  /* ── Clock ─────────────────────────────────────────────── */
  const [now,setNow]=useState(new Date());
  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(t);},[]);
  const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const p2=n=>String(n).padStart(2,"0");
  const dateS=`${p2(now.getDate())}-${MON[now.getMonth()]}-${now.getFullYear()}`;
  const timeS=`${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;

  /* ── addLog ─────────────────────────────────────────────── */
  const addLog=useCallback((src,lbl,hex,ok,meta)=>{
    const ts=`${p2(new Date().getHours())}:${p2(new Date().getMinutes())}:${p2(new Date().getSeconds())}`;
    setPktLog(l=>[{ts,source:src,label:lbl,hex,ok,meta},...l].slice(0,300));
  },[]);

  /* ── Core send — reads from R.current (always fresh) ─────── */
  const execLocoSend=useCallback(async()=>{
    const rc=R.current;
    /* Round and clamp speed: spec allows 0-400, 511=unidentified */
    const safeSpeed = Math.max(0, Math.min(400, Math.round(rc.speed||0)));
    const st={speed:safeSpeed,mode:rc.mode,loc:rc.loc,trainLen:rc.trainLen,
               dir:rc.dir,emg:rc.emg,brake:rc.brake,locoId:parseInt(rc.locoId)||0};
    const pkts=[];
    if(rc.pktType==="c46"||rc.pktType==="both") pkts.push({radio:"0xF1",hex:buildC46pkt(st),lbl:"C.4.6"});
    if(rc.pktType==="c43"||rc.pktType==="both") pkts.push({radio:"0xF1",hex:buildC43pkt(st),lbl:"C.4.3"});
    for(const p of pkts){
      try{
        const r=await fetch(INGEST_URL,{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({packets:[{activeRadio:p.radio,messagePayload:p.hex}],source:"dmi-loco"})});
        setLocoSent(n=>n+1);
        addLog("LOCO",p.lbl,p.hex,r.ok,`${rc.speed}kph ${rc.mode}`);
      }catch(e){addLog("LOCO",p.lbl,"",false,e.message);}
    }
  },[addLog]);

  const execStSend=useCallback(async()=>{
    const rc=R.current;
    const aspCode={"OFF":0,"RED":1,"YELLOW":2,"DYELLOW":10,"GREEN":11,"CALLON":15}[rc.stAspect]||0;
    const authRaw=Math.min(50,Math.max(0,Math.round((rc.stAuth||0)/5)));
    const sigDist=Math.min(32767,Math.max(0,Math.round(rc.stMA*0.4)));  // signal at ~40% of MA
    const maWRT=Math.min(65534,Math.max(0,Math.round(rc.stMA||0)));

    /* ── Derive profile sub-packets from current sim state ──
       SSP: 3 speed zones — full auth speed → 75% → 50% across MA distance
       Gradient: gentle uphill midway, level elsewhere
       LC Gate:  one gate at 35% of MA distance
       Turnout:  one at 60% of MA distance
       TLI:      RFID tags every ~200m from origin up to MA end           */
    const ma=maWRT||500;
    const spd=rc.stAuth||60;

    const ssp=spd>0?[
      {dist:0,           speed:spd},
      {dist:Math.round(ma*0.35), speed:Math.max(10,Math.round(spd*0.75))},
      {dist:Math.round(ma*0.65), speed:Math.max(10,Math.round(spd*0.50))},
    ]:[];

    const grad=[
      {dist:0,                    isUp:false, grad:0},
      {dist:Math.round(ma*0.25),  isUp:true,  grad:5},  // 1:200 uphill
      {dist:Math.round(ma*0.55),  isUp:false, grad:3},  // 1:333 downhill
      {dist:Math.round(ma*0.80),  isUp:false, grad:0},  // level
    ];

    const lc=ma>300?[
      {dist:Math.round(ma*0.35), id:12, unmanned:false},
    ]:[];

    const turnouts=ma>400?[
      {dist:Math.round(ma*0.60), speed:Math.max(10,Math.round(spd*0.4)), relDist:50},
    ]:[];

    /* TLI: tags at every 150–250m, up to 8 tags */
    const tliTags=[];
    const tagStep=Math.max(100,Math.round(ma/6));
    let baseId=Math.round((rc.refRFID||100)+1);
    for(let d=tagStep,i=0;d<ma&&i<7;d+=tagStep,i++){
      tliTags.push({dist:Math.min(tagStep,d),id:(baseId+i)%1023});
    }

    const pkt=buildC42pkt({
      aspCode, authSpeedRaw:authRaw,
      apprSigDist:sigDist, maWRT,
      stnId:431, refRFID:rc.refRFID||361, destLocoId:0,
      frameNum:Math.floor(Date.now()/1000)%131071,
      ssp, grad, lc, turnouts, tliTags,
    });

    try{
      const r=await fetch(INGEST_URL,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({packets:[{activeRadio:"0xAA",messagePayload:pkt}],source:"dmi-station"})});
      setStSent(n=>n+1);
      addLog("STN","C.4.2",pkt,r.ok,`MA:${ma}m Auth:${rc.stAuth}kph SSP:${ssp.length} TLI:${tliTags.length}`);
    }catch(e){addLog("STN","C.4.2","",false,e.message);}
  },[addLog]);

  /* ── Auto-TX: stable interval — restart on interval change ── */
  useEffect(()=>{
    clearInterval(locoRef.current);
    if(!locoAuto){return;}
    locoRef.current=setInterval(execLocoSend, locoMs);
    return()=>clearInterval(locoRef.current);
  },[locoAuto, locoMs, execLocoSend]);

  useEffect(()=>{
    clearInterval(stRef.current);
    if(!stAuto){return;}
    stRef.current=setInterval(execStSend, stMs);
    return()=>clearInterval(stRef.current);
  },[stAuto, stMs, execStSend]);

  /* ── Simulation ──────────────────────────────────────────── */
  useEffect(()=>{
    clearInterval(simRef.current);
    if(!simRunning){return;}
    simRef.current=setInterval(()=>{
      const auth=R.current.stAuth;
      setStMA(m=>{
        const nm=Math.max(0,m-3);
        R.current.stMA=nm;
        return nm;
      });
      setStProf(p=>Math.max(0,p-3));
      setLoc(l=>{const nl=+(l+0.003).toFixed(3);R.current.loc=nl;return nl;});
      setTgtDist(d=>d!==null?Math.max(0,d-3):null);
      setSpeed(prev=>{
        const maOk=R.current.stMA>0;
        let cs;
        if(!maOk){
          cs=Math.max(0,prev-3);
          setBrakeActive(cs>0);
        } else {
          const ceil=Math.min(MODE_INFO[R.current.mode]?.maxSpeed??200,auth);
          const diff=tgtSpd-prev;
          const raw=prev+(diff>0?Math.min(diff,2):Math.max(diff,-4))+(Math.random()-.5)*1.0;
          const ns=Math.max(0,Math.min(400,raw));   // spec max is 400 kmph
          cs=Math.min(ns,ceil);
          setBrakeActive(ns>ceil);
        }
        /* Update R.current SYNCHRONOUSLY here — before any render cycle —
           so execLocoSend always reads the fresh speed value             */
        R.current.speed=cs;
        return cs;
      });
    },200);
    return()=>clearInterval(simRef.current);
  },[simRunning,tgtSpd]);

  /* ── Scroll log to top (newest first) ───────────────────── */
  useEffect(()=>{ if(logRef.current)logRef.current.scrollTop=0; },[pktLog]);

  /* ── Soft keys ───────────────────────────────────────────── */
  const handleKey=useCallback((idx,lbl)=>{
    setAKey(idx);setTimeout(()=>setAKey(null),600);
    if(lbl==="SR")  setMode("SR");
    if(lbl==="SHNT")setMode("SH");
    if(lbl==="REV") setMode("RV");
    if(lbl==="OVRD")setMode("OV");
    if(lbl==="P_TRP"&&R.current.mode==="TR")setMode("PT");
  },[]);

  /* ── Scenario presets ────────────────────────────────────── */
  const SCEN=[
    {l:"✅ FS Run",    fn:()=>{setMode("FS");setTgtSpd(80);setStMA(2500);setStProf(3000);setStAuth(100);setStAspect("GREEN");setMsgH("Full Supervision Mode");setMsgI("");setEmg(0);}},
    {l:"⚠ SR Mode",   fn:()=>{setMode("SR");setTgtSpd(25);setStMA(1000);setStProf(1500);setStAuth(30); setStAspect("RED");  setMsgH("Ack SR mode, KAVACH Territory");setMsgI("");}},
    {l:"🔴 Trip",     fn:()=>{setMode("TR");setTgtSpd(0);setMsgH("Train Tripped, Select P_Trip");setMsgI("");}},
    {l:"🚨 SOS",      fn:()=>{setEmg(2);setMsgH("SOS – Self Loco (Manual)");setMsgI("SOS – Self Loco (Manual)");}},
    {l:"🔀 Turnout",  fn:()=>{setMode("FS");setTgtSpd(30);setStMA(855);setStProf(1000);setStAuth(30);setStAspect("DYELLOW");setMsgH("TurnOut in 0855m with Speed Limit 030kmph");setTgtDist(855);setTgtType("Turnout");}},
    {l:"📻 RadioHole",fn:()=>{setRadioHole(true);setRfBars(0);setMode("SR");setMsgH("Approaching Radio Hole in 0500 m");}},
  ];
  const ST_PRESETS=[
    {l:"🟢 Clear",  c:"#10b981",fn:()=>{setStMA(2500);setStProf(3000);setStAuth(100);setStAspect("GREEN");setStSigD(876);}},
    {l:"🟡 Caution",c:"#f59e0b",fn:()=>{setStMA(800); setStProf(1200);setStAuth(60); setStAspect("YELLOW");setStSigD(500);}},
    {l:"🔴 Block",  c:"#ef4444",fn:()=>{setStMA(0);   setStProf(0);   setStAuth(0);  setStAspect("RED");  setMsgH("Brake Applied, Dead End Detected");}},
    {l:"🔀 Turnout",c:"#8b5cf6",fn:()=>{setStMA(855); setStProf(1000);setStAuth(30); setStAspect("DYELLOW");setTgtDist(855);setTgtType("Turnout");}},
    {l:"🚧 Shunt",  c:"#06b6d4",fn:()=>{setStMA(200); setStProf(200); setStAuth(15); setStAspect("CALLON");setMode("SH");}},
  ];

  const hC=emg>0?DC.BRD:brakeActive?DC.LOR:DC.WHT;

  /* ══════════════════════════════════════════════════
     LAYOUT:
       flex-column (full height)
       ├─ topbar strip (shrink:0)
       ├─ body flex-row (flex:1, overflow:hidden)
       │   ├─ LEFT 816px: DMI screen (flexShrink:0, scrollable)
       │   └─ RIGHT flex:1: controls panel (scrollable)
       └─ packet log strip (shrink:0, bottom, full width)
  ══════════════════════════════════════════════════ */
  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0,background:"var(--void)"}}>

      {/* ── TOPBAR STRIP ── */}
      <div style={{padding:"5px 12px",background:"var(--surf)",borderBottom:"1px solid var(--bdr)",
        display:"flex",alignItems:"center",gap:6,flexShrink:0,flexWrap:"wrap"}}>
        <div style={{padding:"3px 9px",borderRadius:4,fontSize:9,fontFamily:"var(--mono)",fontWeight:700,flexShrink:0,
          background:maOpen?"rgba(0,255,0,.07)":"rgba(255,0,0,.09)",
          border:`1px solid ${maOpen?"#00ff0033":"#ff000033"}`,
          color:maOpen?"#00FF00":"#ff4444"}}>
          {maOpen?"✅ MA OPEN":"🔒 MA LOCKED"}
        </div>
        <button onClick={()=>setSimRunning(r=>!r)}
          style={{padding:"3px 9px",borderRadius:4,fontSize:9,fontFamily:"var(--mono)",flexShrink:0,
            border:`1px solid ${simRunning?"#10b98155":"var(--bdr)"}`,cursor:"pointer",
            background:simRunning?"rgba(16,185,129,.1)":"transparent",
            color:simRunning?"#10b981":"var(--tm)"}}>
          {simRunning?"⏹ STOP SIM":"▶ SIM"}
        </button>
        {simRunning&&<>
          <input type="range" min={0} max={200} value={tgtSpd}
            onChange={e=>setTgtSpd(+e.target.value)} style={{width:70,accentColor:"#10b981"}}/>
          <span style={{fontSize:9,color:"#10b981",fontFamily:"var(--mono)",minWidth:42,flexShrink:0}}>{tgtSpd} kph</span>
        </>}
        <div style={{width:1,height:18,background:"var(--bdr)",flexShrink:0}}/>
        <span style={{fontSize:8,color:"var(--td)",fontFamily:"var(--mono)",flexShrink:0}}>SCENARIOS:</span>
        {SCEN.map(s=>(
          <button key={s.l} onClick={s.fn}
            style={{padding:"3px 8px",borderRadius:4,background:"var(--raised)",color:"var(--ts)",
              border:"1px solid var(--bdr)",cursor:"pointer",fontSize:9,fontFamily:"var(--mono)",flexShrink:0}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--amber)";e.currentTarget.style.color="var(--amber)";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--bdr)";e.currentTarget.style.color="var(--ts)";}}>
            {s.l}
          </button>
        ))}
      </div>

      {/* ── BODY: DMI (left) | Controls (right) ── */}
      <div style={{flex:1,display:"flex",flexDirection:"row",overflow:"hidden",minHeight:0}}>

        {/* ═══ LEFT: DMI 800px ═══ */}
        <div style={{flexShrink:0,width:816,overflowY:"auto",overflowX:"hidden",
          padding:"8px 8px 0 8px",background:"var(--void)"}}>

          {/* ┌─ DMI SCREEN per Annexure-B Fig B.1 ─────────────────┐
              │ All region borders: 1px solid white                   │
              │ A=92  B=365  C=112  D=231  → total 800               │
              │ Row1 h=388  Row2 h=45  Row3 h=93  Row4 h=25  Row5 h=45 │
              └─────────────────────────────────────────────────────┘ */}
          <div style={{width:800,background:"black",border:"2px solid #777",
            borderRadius:2,overflow:"hidden",boxShadow:"0 0 20px rgba(0,0,0,.9)"}}>

            {/* ROW 1  height=388 */}
            <div style={{display:"flex",height:388,borderBottom:"1px solid #fff"}}>

              {/* Region A — Target Distance  92×388 */}
              <div style={{width:92,height:388,background:"black",flexShrink:0,borderRight:"1px solid #fff"}}>
                <TargetBar dist={tgtDist} type={tgtType}/>
              </div>

              {/* Region B — Speedometer  365×388 */}
              <div style={{width:365,height:388,background:"black",flexShrink:0,position:"relative",borderRight:"1px solid #fff"}}>
                <div style={{position:"absolute",top:8,left:6,textAlign:"left",
                  fontSize:13,fontWeight:"bold",color:DC.WHT,fontFamily:"Helvetica,sans-serif",letterSpacing:".05em"}}>
                  {locoId}
                </div>
                <div style={{position:"absolute",top:8,right:8,textAlign:"right",fontSize:10,
                  fontWeight:"bold",color:DC.WHT,fontFamily:"Helvetica,sans-serif",lineHeight:1.4}}>
                  <div>{dateS}</div><div>{timeS}</div>
                </div>
                <div style={{position:"absolute",top:12,left:Math.round((365-310)/2)}}>
                  <DMISpeedometer speed={speed} permitted={permitted} brakeActive={brakeActive} size={310}/>
                </div>
                {brakeActive&&<div style={{position:"absolute",bottom:36,left:10,fontSize:9,
                  fontWeight:"bold",fontFamily:"Helvetica,sans-serif",
                  color:brakeCode>=4?DC.BRD:DC.ORG,
                  border:`1px solid ${brakeCode>=4?DC.BRD:DC.ORG}`,padding:"1px 5px",borderRadius:3}}>
                  {brakeCode>=4?"EB":brakeCode>=3?"FSB":"NB"}
                </div>}
                <div style={{position:"absolute",bottom:36,left:44,right:44,textAlign:"center",
                  fontSize:11,fontWeight:"bold",color:DC.WHT,fontFamily:"Helvetica,sans-serif"}}>
                  LOC : {loc.toFixed(3)} km
                </div>
                <div style={{position:"absolute",bottom:34,right:8}}>
                  <ModeSym mode={mode} size={34}/>
                </div>
                {permitted>0&&<div style={{position:"absolute",bottom:8,left:8,fontSize:12,
                  fontWeight:"bold",color:DC.WHT,fontFamily:"Helvetica,sans-serif"}}>{permitted}</div>}
              </div>

              {/* Region C — Movement Authority  112×388 */}
              <div style={{width:112,height:388,background:"black",flexShrink:0,borderRight:"1px solid #fff"}}>
                <MABar ma={stMA}/>
              </div>

              {/* Region D — Signal Aspect  231×388 */}
              <div style={{width:231,height:388,background:"black",flexShrink:0}}>
                <SigAspect aspect={stAspect} dir={stDir} sigName={stSigN} sigDist={stSigD}/>
              </div>
            </div>

            {/* ROW 2  height=45: E | F | G | D-lower */}
            <div style={{display:"flex",height:45,borderBottom:"1px solid #fff"}}>
              {/* E — DC/odometer  156×45 */}
              <div style={{width:156,height:45,background:"black",flexShrink:0,
                borderRight:"1px solid #fff",display:"flex",alignItems:"center",paddingLeft:10,
                fontSize:11,color:DC.WHT,fontFamily:"Helvetica,sans-serif"}}>
                DC {dc.toFixed(2)}
              </div>
              {/* F — Train Length  152×45 */}
              <div style={{width:152,height:45,background:"black",flexShrink:0,
                borderRight:"1px solid #fff",display:"flex",alignItems:"center",paddingLeft:10,
                fontSize:11,color:DC.WHT,fontFamily:"Helvetica,sans-serif"}}>
                TL {trainLen} m
              </div>
              {/* G — Mode name  261×45 */}
              <div style={{width:261,height:45,background:"black",flexShrink:0,
                borderRight:"1px solid #fff",display:"flex",alignItems:"center",paddingLeft:13}}>
                <span style={{fontSize:11,color:modeInfo.color,fontFamily:"Helvetica,sans-serif"}}>
                  {modeInfo.name} Mode
                </span>
              </div>
              {/* D lower continuation  231×45 */}
              <div style={{width:231,height:45,background:"black",flexShrink:0}}/>
            </div>

            {/* ROW 3  H(571×55) + I(571×38)  |  J(133×93) + K(96×93) */}
            <div style={{display:"flex",borderBottom:"1px solid #fff"}}>
              {/* H + I left block  571×93 */}
              <div style={{width:571,flexShrink:0,borderRight:"1px solid #fff"}}>
                {/* H — System message  571×55 */}
                <div style={{width:571,height:55,background:"black",borderBottom:"1px solid #fff",
                  display:"flex",alignItems:"center",padding:"0 12px"}}>
                  <span style={{fontSize:14,fontWeight:"bold",color:hC,
                    fontFamily:"Helvetica,sans-serif",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                    {msgH}
                  </span>
                </div>
                {/* I — Context/SOS message  571×38 */}
                <div style={{width:571,height:38,background:"black",
                  display:"flex",alignItems:"center",padding:"0 12px"}}>
                  <span style={{fontSize:12,fontWeight:"bold",
                    color:emg>0?DC.BRD:DC.WHT,fontFamily:"Helvetica,sans-serif",
                    whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                    {msgI}
                  </span>
                </div>
              </div>
              {/* J — RF signal  133×93 */}
              <div style={{width:133,height:93,background:"black",flexShrink:0,borderRight:"1px solid #fff"}}>
                <RFSig bars={rfBars} hole={radioHole}/>
                <div style={{padding:"1px 6px",fontSize:8,color:DC.WHT,
                  fontFamily:"Helvetica,sans-serif",lineHeight:1.5}}>
                  Tid-{locoId}, Dir-{dir==="DN"?"N":"R"}<br/>T Dist-{tgtDist!==null?String(Math.round(tgtDist)).padStart(3,"0"):"—"}
                </div>
              </div>
              {/* K — Tag profile  96×93 */}
              <div style={{width:96,height:93,background:"black",flexShrink:0}}>
                <svg width={96} height={93}>
                  <text x={48} y={10} textAnchor="middle" fontSize={8} fill={DC.WHT} fontFamily="Helvetica,sans-serif">Tag</text>
                  <line x1={44} y1={13} x2={44} y2={88} stroke="#fff" strokeWidth={1}/>
                  <line x1={52} y1={13} x2={52} y2={88} stroke="#fff" strokeWidth={1}/>
                  {[18,38,58].map((y,i)=>(
                    <g key={i}>
                      <line x1={28} y1={y} x2={68} y2={y} stroke="#fff" strokeWidth={1}/>
                      <rect x={35} y={y-5} width={26} height={10} fill={i===0?DC.DGR:DC.GRY} opacity={0.5}/>
                    </g>
                  ))}
                </svg>
              </div>
            </div>

            {/* ROW 4 — D3 strip  800×25 */}
            <div style={{height:25,background:"black",borderBottom:"1px solid #fff",
              display:"flex",alignItems:"center",paddingLeft:10}}>
              <span style={{fontSize:9,color:DC.ORG,fontFamily:"Helvetica,sans-serif"}}>
                {stDir} {stSigN}
              </span>
            </div>

            {/* ROW 5 — Soft function keys  800×45 */}
            <div style={{display:"flex",height:45,background:"#0c0c16"}}>
              {SOFTKEYS.map((lbl,i)=>(
                <button key={i} onClick={()=>lbl&&handleKey(i,lbl)}
                  style={{flex:1,height:"100%",
                    background:aKey===i?"#d0d0d8":"#0c0c16",
                    color:aKey===i?"#000":(lbl?DC.WHT:"#2a2a3a"),
                    border:"1px solid #1a1a28",fontSize:9,
                    fontFamily:"Helvetica,sans-serif",cursor:lbl?"pointer":"default",
                    fontWeight:aKey===i?"bold":"normal"}}>
                  {lbl||"—"}
                </button>
              ))}
            </div>

          </div>{/* end DMI */}
        </div>{/* end LEFT */}

        {/* ═══ RIGHT: Scrollable control panels ═══ */}
        <div style={{flex:1,display:"flex",flexDirection:"column",background:"var(--surf)",
          borderLeft:"1px solid var(--bdr)",overflow:"hidden",minWidth:340}}>
          <div style={{flex:1,overflowY:"auto",overflowX:"hidden"}}>

            {/* ╔══ 🚆 LOCO TX ══╗ */}
            <div style={{borderBottom:"2px solid rgba(245,158,11,.2)"}}>
              <div style={{padding:"7px 14px 4px",display:"flex",alignItems:"center",gap:8,
                background:"linear-gradient(90deg,rgba(245,158,11,.07),transparent)"}}>
                <span style={{fontSize:10,fontWeight:700,color:"#f59e0b",fontFamily:"var(--mono)",letterSpacing:".08em"}}>
                  🚆 LOCO TX
                </span>
                <span style={{fontSize:8,color:"var(--td)",fontFamily:"var(--mono)"}}>
                  C.4.6 Access Request + C.4.3 L2S Regular
                </span>
                <span style={{marginLeft:"auto",fontSize:9,color:"var(--td)",fontFamily:"var(--mono)"}}>
                  Sent: <span style={{color:"#f59e0b"}}>{locoSent}</span>
                </span>
              </div>
              <div style={{padding:"0 14px 10px",display:"flex",flexDirection:"column",gap:7}}>
                {/* Mode + Emergency */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  <div>
                    <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginBottom:2}}>Mode</div>
                    <select value={mode} onChange={e=>setMode(e.target.value)}
                      style={{width:"100%",padding:"4px 6px",background:"var(--raised)",
                        color:modeInfo.color,border:`1px solid ${modeInfo.color}44`,borderRadius:4,fontSize:10}}>
                      {Object.entries(MODE_INFO).map(([k,v])=><option key={k} value={k}>{v.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginBottom:2}}>Emergency</div>
                    <select value={emg} onChange={e=>setEmg(+e.target.value)}
                      style={{width:"100%",padding:"4px 6px",
                        background:emg>0?"rgba(180,0,0,.15)":"var(--raised)",
                        color:emg>0?"#ff5555":"var(--tm)",
                        border:`1px solid ${emg>0?"#ff444444":"var(--bdr)"}`,borderRadius:4,fontSize:10}}>
                      <option value={0}>0 — No Emergency</option>
                      <option value={1}>1 — Unusual Stoppage</option>
                      <option value={2}>2 — SoS</option>
                      <option value={3}>3 — Roll Back</option>
                      <option value={4}>4 — Head-On Collision</option>
                      <option value={5}>5 — Rear-End Collision</option>
                    </select>
                  </div>
                </div>
                {/* Speed + Train length */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  <div>
                    <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginBottom:2}}>
                      Speed: <span style={{color:"#10b981"}}>{speed} kmph</span>
                    </div>
                    <input type="range" min={0} max={250} value={speed}
                      onChange={e=>{const v=+e.target.value;setSpeed(v);R.current.speed=v;setBrakeActive(v>permitted);}}
                      style={{width:"100%",accentColor:"#10b981"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginBottom:2}}>
                      Train Len: <span style={{color:"var(--amber)"}}>{trainLen} m</span>
                    </div>
                    <input type="range" min={50} max={2000} value={trainLen}
                      onChange={e=>{const v=+e.target.value;setTrainLen(v);R.current.trainLen=v;}}
                      style={{width:"100%",accentColor:"var(--amber)"}}/>
                  </div>
                </div>
                {/* Loco ID + Direction */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  <div>
                    <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginBottom:2}}>Loco ID</div>
                    <input value={locoId} onChange={e=>{setLocoId(e.target.value);R.current.locoId=e.target.value;}} maxLength={6}
                      style={{width:"100%",padding:"4px 6px",background:"var(--inp)",color:"var(--cyan)",
                        border:"1px solid var(--bdr)",borderRadius:4,fontSize:11,fontFamily:"var(--mono)"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginBottom:2}}>Direction</div>
                    <select value={dir} onChange={e=>{setDir(e.target.value);R.current.dir=e.target.value;}}
                      style={{width:"100%",padding:"4px 6px",background:"var(--raised)",color:"var(--tp)",
                        border:"1px solid var(--bdr)",borderRadius:4,fontSize:10}}>
                      <option value="DN">DN — Nominal</option>
                      <option value="UP">UP — Reverse</option>
                    </select>
                  </div>
                </div>
                {/* H message */}
                <div>
                  <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginBottom:2}}>
                    Region H — System Message
                  </div>
                  <select value={msgH} onChange={e=>setMsgH(e.target.value)}
                    style={{width:"100%",padding:"4px 6px",background:"var(--raised)",color:"var(--tp)",
                      border:"1px solid rgba(245,158,11,.3)",borderRadius:4,fontSize:10,fontFamily:"var(--mono)"}}>
                    {H_MSGS.map((m,i)=><option key={i} value={m}>{m||"— (blank)"}</option>)}
                  </select>
                </div>
                {/* I message */}
                <div>
                  <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginBottom:2}}>
                    Region I — Context / SOS Message
                  </div>
                  <select value={msgI} onChange={e=>setMsgI(e.target.value)}
                    style={{width:"100%",padding:"4px 6px",background:"var(--raised)",color:"var(--tp)",
                      border:"1px solid rgba(239,68,68,.3)",borderRadius:4,fontSize:10,fontFamily:"var(--mono)"}}>
                    {I_MSGS.map((m,i)=><option key={i} value={m}>{m||"— (blank)"}</option>)}
                  </select>
                </div>
                {/* Packet type + RF */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  <div>
                    <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginBottom:2}}>Packet Type</div>
                    <div style={{display:"flex",gap:3}}>
                      {[{id:"both",l:"Both"},{id:"c46",l:"C.4.6"},{id:"c43",l:"C.4.3"}].map(p=>(
                        <button key={p.id} onClick={()=>{setPktType(p.id);R.current.pktType=p.id;}}
                          style={{flex:1,padding:"4px 0",borderRadius:4,fontSize:9,fontFamily:"var(--mono)",cursor:"pointer",
                            border:`1px solid ${pktType===p.id?"var(--amber)":"var(--bdr)"}`,
                            background:pktType===p.id?"var(--aglow)":"transparent",
                            color:pktType===p.id?"var(--amber)":"var(--tm)"}}>
                          {p.l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginBottom:2}}>
                      RF: <span style={{color:"#00FF00"}}>{rfBars}/5</span>{radioHole&&<span style={{color:"#f00"}}> HOLE</span>}
                    </div>
                    <div style={{display:"flex",gap:4,alignItems:"center"}}>
                      <input type="range" min={0} max={5} value={rfBars} onChange={e=>setRfBars(+e.target.value)}
                        style={{flex:1,accentColor:"#00FF00"}}/>
                      <button onClick={()=>setRadioHole(r=>!r)}
                        style={{padding:"2px 6px",borderRadius:3,fontSize:9,cursor:"pointer",
                          background:radioHole?"rgba(255,0,0,.1)":"rgba(0,255,0,.05)",
                          border:`1px solid ${radioHole?"#f006":"#0f06"}`,
                          color:radioHole?"#f44":"#0f0"}}>
                        {radioHole?"📵":"📡"}
                      </button>
                    </div>
                  </div>
                </div>
                {/* Loco TX bar */}
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"7px 10px",borderRadius:6,
                  background:"rgba(245,158,11,.05)",border:"1px solid rgba(245,158,11,.2)"}}>
                  <select value={locoMs} onChange={e=>{const v=+e.target.value;setLocoMs(v);R.current.locoMs=v;}}
                    style={{padding:"4px 7px",background:"var(--raised)",color:"var(--ts)",
                      border:"1px solid var(--bdr)",borderRadius:4,fontSize:9,fontFamily:"var(--mono)"}}>
                    {[200,500,1000,2000,5000].map(v=><option key={v} value={v}>{v<1000?v+"ms":v/1000+"s"}</option>)}
                  </select>
                  <button onClick={()=>setLocoAuto(a=>!a)} disabled={be===false}
                    style={{flex:1,padding:"7px 0",borderRadius:5,fontWeight:800,border:"none",cursor:"pointer",
                      background:locoAuto?"linear-gradient(135deg,#dc2626,#991b1b)":"linear-gradient(135deg,#f59e0b,#d97706)",
                      color:"#fff",fontSize:10,fontFamily:"var(--mono)",
                      boxShadow:locoAuto?"0 0 12px rgba(220,38,38,.4)":"0 0 8px rgba(245,158,11,.3)"}}>
                    {locoAuto?"⏹ STOP AUTO TX":"▶ AUTO TX"}
                  </button>
                  <button onClick={execLocoSend} disabled={be===false}
                    style={{padding:"7px 14px",borderRadius:5,fontWeight:700,cursor:"pointer",
                      background:"rgba(245,158,11,.12)",border:"1px solid rgba(245,158,11,.4)",
                      color:"#f59e0b",fontSize:10,fontFamily:"var(--mono)"}}>
                    ⚡ SEND
                  </button>
                </div>
              </div>
            </div>{/* end LOCO TX */}

            {/* ╔══ 📡 STATION TX ══╗ */}
            <div>
              <div style={{padding:"7px 14px 4px",display:"flex",alignItems:"center",gap:8,
                background:"linear-gradient(90deg,rgba(6,182,212,.07),transparent)"}}>
                <span style={{fontSize:10,fontWeight:700,color:"#06b6d4",fontFamily:"var(--mono)",letterSpacing:".08em"}}>
                  📡 STATION TX
                </span>
                <span style={{fontSize:8,color:"var(--td)",fontFamily:"var(--mono)"}}>
                  C.4.2 S2L Regular — Grants MA to Loco
                </span>
                <span style={{marginLeft:"auto",fontSize:9,color:"var(--td)",fontFamily:"var(--mono)"}}>
                  Sent: <span style={{color:"#06b6d4"}}>{stSent}</span>
                </span>
              </div>
              <div style={{padding:"0 14px 12px",display:"flex",flexDirection:"column",gap:7}}>
                {/* MA gate status */}
                <div style={{padding:"5px 10px",borderRadius:5,fontSize:9,fontFamily:"var(--mono)",lineHeight:1.6,
                  background:maOpen?"rgba(0,255,0,.05)":"rgba(255,80,0,.08)",
                  border:`1px solid ${maOpen?"#0f03":"rgba(255,100,0,.3)"}`,
                  color:maOpen?"#0f0":"#ffa040"}}>
                  {maOpen?`✅ MA OPEN — MA: ${stMA}m  Profile: ${stProf}m`
                         :"⛔ LOCKED — Set MA > 0 AND Track Profile > 0"}
                </div>
                {/* MA + Profile */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  <div>
                    <div style={{fontSize:8,fontFamily:"var(--mono)",marginBottom:2,color:stMA>0?"#0f0":"#f44"}}>
                      MA: {stMA} m {stMA===0?"⛔":stMA<500?"⚠":"✅"}
                    </div>
                    <input type="range" min={0} max={3000} value={stMA}
                      onChange={e=>{const v=+e.target.value;setStMA(v);R.current.stMA=v;}}
                      style={{width:"100%",accentColor:stMA>0?"#0f0":"#f44"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:8,fontFamily:"var(--mono)",marginBottom:2,color:stProf>0?"#0f0":"#f44"}}>
                      Track Profile: {stProf} m {stProf===0?"⛔":"✅"}
                    </div>
                    <input type="range" min={0} max={3000} value={stProf}
                      onChange={e=>setStProf(+e.target.value)}
                      style={{width:"100%",accentColor:stProf>0?"#0f0":"#f44"}}/>
                  </div>
                </div>
                {/* Auth speed + Aspect */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  <div>
                    <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginBottom:2}}>
                      Auth Speed: <span style={{color:"#DFDF00"}}>{stAuth} kmph</span>
                    </div>
                    <input type="range" min={0} max={200} value={stAuth}
                      onChange={e=>{const v=+e.target.value;setStAuth(v);R.current.stAuth=v;}}
                      style={{width:"100%",accentColor:"#DFDF00"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginBottom:2}}>Signal Aspect</div>
                    <select value={stAspect} onChange={e=>{setStAspect(e.target.value);R.current.stAspect=e.target.value;}}
                      style={{width:"100%",padding:"4px 6px",background:"var(--raised)",color:"var(--tp)",
                        border:"1px solid var(--bdr)",borderRadius:4,fontSize:10}}>
                      {Object.keys(SIG_ASPECTS).map(k=><option key={k} value={k}>{SIG_ASPECTS[k].name}</option>)}
                    </select>
                  </div>
                </div>
                {/* Signal dist + Direction */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  <div>
                    <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginBottom:2}}>
                      Signal Dist: <span style={{color:"var(--ts)"}}>{stSigD} m</span>
                    </div>
                    <input type="range" min={0} max={9999} value={stSigD}
                      onChange={e=>setStSigD(+e.target.value)} style={{width:"100%",accentColor:"#aaa"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginBottom:2}}>Direction</div>
                    <select value={stDir} onChange={e=>setStDir(e.target.value)}
                      style={{width:"100%",padding:"4px 6px",background:"var(--raised)",color:"var(--tp)",
                        border:"1px solid var(--bdr)",borderRadius:4,fontSize:10}}>
                      {["UP","DN","UP FAST","DN FAST","UP SLOW","DN SLOW","UP MAIN","DN MAIN"].map(d=>(
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {/* Signal name + Target */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  <div>
                    <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginBottom:2}}>Signal Name (D3)</div>
                    <input value={stSigN} onChange={e=>setStSigN(e.target.value)}
                      style={{width:"100%",padding:"4px 6px",background:"var(--inp)",color:"var(--tp)",
                        border:"1px solid var(--bdr)",borderRadius:4,fontSize:10}}/>
                  </div>
                  <div>
                    <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginBottom:2}}>Target Dist (A)</div>
                    <div style={{display:"flex",gap:4}}>
                      <input type="number" value={tgtDist||""} onChange={e=>setTgtDist(e.target.value?+e.target.value:null)}
                        placeholder="— m"
                        style={{flex:1,padding:"4px 5px",background:"var(--inp)",color:DC.LOR,
                          border:"1px solid var(--bdr)",borderRadius:4,fontSize:10,fontFamily:"var(--mono)"}}/>
                      <select value={tgtType} onChange={e=>setTgtType(e.target.value)}
                        style={{flex:1,padding:"4px 4px",background:"var(--raised)",color:"var(--tp)",
                          border:"1px solid var(--bdr)",borderRadius:4,fontSize:9}}>
                        {["Turnout","PSR","TSR","EOA","SoS","Collision"].map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
                {/* Presets */}
                <div>
                  <div style={{fontSize:8,color:"var(--td)",fontFamily:"var(--mono)",marginBottom:4}}>PRESETS:</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    {ST_PRESETS.map(p=>(
                      <button key={p.l} onClick={p.fn}
                        style={{padding:"4px 9px",borderRadius:4,fontSize:9,cursor:"pointer",
                          background:`${p.c}12`,color:p.c,border:`1px solid ${p.c}44`,
                          fontFamily:"var(--mono)",fontWeight:600}}
                        onMouseEnter={e=>e.currentTarget.style.background=`${p.c}22`}
                        onMouseLeave={e=>e.currentTarget.style.background=`${p.c}12`}>
                        {p.l}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Station TX bar */}
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"7px 10px",borderRadius:6,
                  background:"rgba(6,182,212,.05)",border:"1px solid rgba(6,182,212,.2)"}}>
                  <select value={stMs} onChange={e=>{const v=+e.target.value;setStMs(v);R.current.stMs=v;}}
                    style={{padding:"4px 7px",background:"var(--raised)",color:"var(--ts)",
                      border:"1px solid var(--bdr)",borderRadius:4,fontSize:9,fontFamily:"var(--mono)"}}>
                    {[200,500,1000,2000,5000].map(v=><option key={v} value={v}>{v<1000?v+"ms":v/1000+"s"}</option>)}
                  </select>
                  <button onClick={()=>setStAuto(a=>!a)} disabled={be===false}
                    style={{flex:1,padding:"7px 0",borderRadius:5,fontWeight:800,border:"none",cursor:"pointer",
                      background:stAuto?"linear-gradient(135deg,#dc2626,#991b1b)":"linear-gradient(135deg,#06b6d4,#0891b2)",
                      color:"#fff",fontSize:10,fontFamily:"var(--mono)",
                      boxShadow:stAuto?"0 0 12px rgba(220,38,38,.4)":"0 0 8px rgba(6,182,212,.3)"}}>
                    {stAuto?"⏹ STOP AUTO TX":"▶ AUTO TX"}
                  </button>
                  <button onClick={execStSend} disabled={be===false}
                    style={{padding:"7px 14px",borderRadius:5,fontWeight:700,cursor:"pointer",
                      background:"rgba(6,182,212,.12)",border:"1px solid rgba(6,182,212,.4)",
                      color:"#06b6d4",fontSize:10,fontFamily:"var(--mono)"}}>
                    ⚡ SEND
                  </button>
                </div>
              </div>
            </div>{/* end STATION TX */}

          </div>
        </div>{/* end RIGHT */}

      </div>{/* end BODY */}

      {/* ═══ PACKET LOG — full-width strip at bottom ═══
          The WIDGET is horizontal (full width of screen).
          Entries are VERTICAL rows inside it (newest first).
          Uses only theme CSS vars — works in dark AND light mode.
      ═══════════════════════════════════════════════════════ */}
      <div style={{flexShrink:0,background:"var(--surf)",borderTop:"2px solid var(--bdr2)"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"3px 12px",
          background:"var(--raised)",borderBottom:"1px solid var(--bdr)"}}>
          <span style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",
            textTransform:"uppercase",letterSpacing:".12em",flexShrink:0}}>
            📡 PACKET TRANSMIT LOG
          </span>
          {locoAuto&&<span className="blink" style={{fontSize:8,color:"#f59e0b",fontFamily:"var(--mono)",flexShrink:0}}>
            ● LOCO AUTO
          </span>}
          {stAuto&&<span className="blink" style={{fontSize:8,color:"#06b6d4",fontFamily:"var(--mono)",flexShrink:0}}>
            ● STN AUTO
          </span>}
          {/* Column labels */}
          <div style={{flex:1,display:"flex",paddingLeft:12,gap:0}}>
            {[["TIME",52],["SOURCE",78],["META",110],["HEX PAYLOAD (full)",null]].map(([h,w])=>(
              <span key={h} style={{fontSize:7,color:"var(--td)",fontFamily:"var(--mono)",
                textTransform:"uppercase",letterSpacing:".07em",flexShrink:0,
                width:w||undefined,flex:w?undefined:1}}>{h}</span>
            ))}
          </div>
          <span style={{fontSize:8,color:"var(--td)",fontFamily:"var(--mono)",flexShrink:0}}>
            {pktLog.length}/300
          </span>
          <button onClick={()=>setPktLog([])}
            style={{background:"transparent",border:"1px solid var(--bdr)",borderRadius:3,
              fontSize:8,padding:"1px 6px",color:"var(--tm)",cursor:"pointer",fontFamily:"var(--mono)",flexShrink:0}}
            onMouseEnter={e=>{e.currentTarget.style.color="var(--red)";e.currentTarget.style.borderColor="var(--red)";}}
            onMouseLeave={e=>{e.currentTarget.style.color="var(--tm)";e.currentTarget.style.borderColor="var(--bdr)";}}>
            ✕ CLR
          </button>
        </div>
        {/* Rows */}
        <div ref={logRef} style={{overflowY:"auto",maxHeight:148,minHeight:44}}>
          {pktLog.length===0?(
            <div style={{padding:"12px",color:"var(--td)",fontSize:9,fontFamily:"var(--mono)",textAlign:"center"}}>
              No packets yet — press ▶ AUTO TX or ⚡ SEND
            </div>
          ):pktLog.map((e,i)=>{
            const isStn=e.source==="STN";
            const c=!e.ok?"#ef4444":isStn?"#06b6d4":e.label==="C.4.6"?"#f59e0b":"#10b981";
            return(
              <div key={i} style={{
                display:"flex",alignItems:"center",gap:0,
                padding:"2px 12px",
                borderBottom:"1px solid var(--bdr)",
                borderLeft:`3px solid ${c}`,
                background:i===0?"var(--alt)":"transparent",
              }}>
                <span style={{fontSize:8,color:"var(--td)",fontFamily:"var(--mono)",width:52,flexShrink:0}}>{e.ts}</span>
                <span style={{fontSize:9,color:c,fontWeight:700,fontFamily:"var(--mono)",width:78,flexShrink:0}}>
                  {e.source} {e.label}
                </span>
                <span style={{fontSize:8,color:"var(--ts)",fontFamily:"var(--mono)",width:110,flexShrink:0,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.meta}</span>
                <span style={{fontSize:8,color:e.ok?"var(--tc)":"#ef4444",flex:1,
                  fontFamily:"var(--mono)",letterSpacing:".03em",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {e.hex||(!e.ok?"ERROR: "+e.meta:"—")}
                </span>
              </div>
            );
          })}
        </div>
      </div>{/* end LOG */}

    </div>
  );
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
  // theme changed in the DECODEX tab → follow it here (and vice versa, App listens too)
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
          <a href="/" style={{fontSize:10,color:"var(--ts)",fontFamily:"var(--mono)",textDecoration:"none",padding:"3px 10px",borderRadius:5,border:"1px solid var(--bdr2)",background:"var(--raised)",flexShrink:0,transition:"all .15s"}}
            onMouseEnter={e=>{e.target.style.color="var(--amber)";e.target.style.borderColor="var(--amber)";}}
            onMouseLeave={e=>{e.target.style.color="var(--ts)";e.target.style.borderColor="var(--bdr2)";}}>← DECODEX</a>
          <div style={{width:1,height:24,background:"var(--bdr2)",flexShrink:0}}/>
          <div style={{width:30,height:30,borderRadius:7,background:"linear-gradient(135deg,#10b981,#059669)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0,boxShadow:"0 0 12px rgba(16,185,129,.35)"}}>📤</div>
          <div>
            <div style={{fontFamily:"var(--hd)",fontSize:16,letterSpacing:".14em",color:"#10b981",lineHeight:1}}>PACKET SIMULATOR</div>
            <div style={{fontSize:8,color:"var(--tm)",fontFamily:"var(--mono)",marginTop:2,letterSpacing:".04em"}}>KAVACH DECODEX · ADVANCED BIT-LEVEL TEST TOOL · RDSO/SPN/196/2020 V4.0</div>
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
          <ThemeTog light={light} onT={()=>setLight(l=>!l)}/>
        </div>

        {/* PAGE CONTENT */}
        <div style={pageBox("dmi")}><DMIPage be={be}/></div>
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
                <button onClick={sending?stopAuto:startAuto} disabled={be===false&&!sending}
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
                <span style={{color:"var(--green)"}}>→ DECODEX LIVE</span>
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