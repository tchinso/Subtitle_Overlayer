
(function(){
  const parser = window.HiyoriSubParser;

  const state = {
    videos: new Map(),
    defaultSettings: {
      font: '"Noto Sans CJK KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif',
      fontSize: 48,
      color: "#ffffff",
      bgColor: "#000000",
      bgOpacity: 0.8,
      textShadow: true,
      visible: true
    }
  };

  // Deep search for videos across open shadow roots
  function findVideosDeep(root) {
    const out = [];
    const visit = (node) => {
      if (!node) return;
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node;
        if (el.tagName === "VIDEO") out.push(el);
        // traverse children
        for (const c of el.children) visit(c);
        // traverse open shadow root if present
        const sr = el.shadowRoot;
        if (sr) visit(sr);
      } else if (node instanceof ShadowRoot || node instanceof Document || node instanceof DocumentFragment) {
        for (const c of node.children || []) visit(c);
      }
    };
    visit(root || document);
    return out;
  }

  function ensureOverlay(video) {
    let rec = state.videos.get(video);
    if (rec && rec.overlay && rec.overlay.isConnected) return rec.overlay;

    const overlay = document.createElement("div");
    overlay.className = "hiyori-sub-overlay";
    overlay.style.setProperty("--hiyori-font", state.defaultSettings.font);
    overlay.style.setProperty("--hiyori-font-size", state.defaultSettings.fontSize + "px");
    overlay.style.setProperty("--hiyori-color", state.defaultSettings.color);

    const textBox = document.createElement("div");
    textBox.className = "hiyori-sub-text";
    overlay.appendChild(textBox);

    const parent = video.parentElement || video;
    const cs = getComputedStyle(parent);
    const prevPos = parent.style.position;
    if (cs.position === "static") parent.style.position = "relative";
    overlay.dataset.hiyoriParentPrevPos = (cs.position === "static") ? (prevPos || "static") : cs.position;

    parent.appendChild(overlay);

    document.addEventListener("fullscreenchange", ()=>{
      try {
        const fs = document.fullscreenElement;
        if (!fs) return;
        if (fs === video) {
          video.appendChild(overlay);
          Object.assign(overlay.style, {position:"absolute", left:"0", top:"0", width:"100%", height:"100%"});
        }
      } catch(e){}
    });

    rec = { overlay, textBox, cues: [], currentIndex: -1, offset: 0, settings: {...state.defaultSettings} };
    state.videos.set(video, rec);
    bindVideo(video);
    applySettings(video);
    return overlay;
  }

  function hexToRGBA(hex, alpha) {
    let h = (hex||"#000").replace("#","").trim();
    if (h.length===3) h = h.split("").map(c=>c+c).join("");
    const r = parseInt(h.slice(0,2),16)||0, g = parseInt(h.slice(2,4),16)||0, b = parseInt(h.slice(4,6),16)||0;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function applySettings(video) {
    const rec = state.videos.get(video);
    if (!rec) return;
    const { overlay, textBox, settings } = rec;
    overlay.style.setProperty("--hiyori-font", settings.font);
    overlay.style.setProperty("--hiyori-font-size", settings.fontSize + "px");
    overlay.style.setProperty("--hiyori-color", settings.color);
    textBox.style.background = hexToRGBA(settings.bgColor, settings.bgOpacity);
    textBox.style.textShadow = settings.textShadow ? "0 0 6px rgba(0,0,0,0.6), 0 0 2px rgba(0,0,0,0.8)" : "none";
    overlay.classList.toggle("hiyori-hidden", !settings.visible);
  }

  function bindVideo(video) {
    if (video.dataset.hiyoriBound) return;
    video.dataset.hiyoriBound = "1";

    const onTime = ()=>{
      const rec = state.videos.get(video);
      if (!rec || !rec.cues || rec.cues.length===0) return;
      const t = (video.currentTime || 0) + (rec.offset||0)/1000;
      // binary search
      let lo=0, hi=rec.cues.length-1, idx=-1;
      while (lo<=hi) {
        const mid=(lo+hi)>>1, c=rec.cues[mid];
        if (t < c.start) hi=mid-1;
        else if (t > c.end) lo=mid+1;
        else { idx=mid; break; }
      }
      if (idx !== rec.currentIndex) {
        rec.currentIndex = idx;
        rec.textBox.innerHTML = idx>=0 ? rec.cues[idx].text : "";
      }
    };

    ["timeupdate","seeked","ratechange","play","pause"].forEach(ev=>video.addEventListener(ev,onTime));
    let rafId; const tick = ()=>{ onTime(); rafId = requestAnimationFrame(tick); }; rafId = requestAnimationFrame(tick);

    const cleanup = ()=>{
      cancelAnimationFrame(rafId);
      const rec = state.videos.get(video);
      if (rec && rec.overlay && rec.overlay.parentElement) {
        const parent = rec.overlay.parentElement;
        parent.removeChild(rec.overlay);
        if (rec.overlay.dataset.hiyoriParentPrevPos === "static") parent.style.position = "";
      }
      state.videos.delete(video);
    };
    video.addEventListener("emptied", cleanup);
    window.addEventListener("unload", cleanup);
  }

  function listVideosInfo() {
    const vids = findVideosDeep(document);
    return vids.map((v,i)=>{
      const r = (v.getBoundingClientRect && v.getBoundingClientRect()) || {width:0,height:0};
      const playing = !v.paused && !v.ended && v.readyState>2;
      return { index:i, width: Math.round(r.width), height: Math.round(r.height), playing };
    });
  }

  // periodic watch to bind newly added videos (including inside open shadow DOM)
  setInterval(()=>{
    const vids = findVideosDeep(document);
    for (const v of vids) ensureOverlay(v);
  }, 1000);

  // Decoding and messages identical to prior version
  function decodeArrayBuffer(buf, preferred) {
    const u8 = new Uint8Array(buf);
    if (u8.length>=3 && u8[0]===0xEF && u8[1]===0xBB && u8[2]===0xBF) return new TextDecoder("utf-8").decode(u8.subarray(3));
    if (u8.length>=2 && u8[0]===0xFF && u8[1]===0xFE) return new TextDecoder("utf-16le").decode(u8.subarray(2));
    if (u8.length>=2 && u8[0]===0xFE && u8[1]===0xFF) return new TextDecoder("utf-16be").decode(u8.subarray(2));
    if (preferred && preferred !== "auto") {
      try { return new TextDecoder(preferred).decode(u8); } catch(e) {}
      if (preferred.toLowerCase()==="cp949" || preferred.toLowerCase()==="ms949") {
        try { return new TextDecoder("euc-kr").decode(u8); } catch(e){}
      }
    }
    try { return new TextDecoder("utf-8", {fatal:true}).decode(u8); } catch(e) {}
    let zeros = 0; for (let i=0; i<u8.length; i+=2) if (u8[i]===0 || u8[i+1]===0) zeros++;
    if (zeros > u8.length/4) {
      try { return new TextDecoder("utf-16le").decode(u8); } catch(e){}
      try { return new TextDecoder("utf-16be").decode(u8); } catch(e){}
    }
    try { return new TextDecoder("euc-kr").decode(u8); } catch(e) {}
    try { return new TextDecoder("windows-1252").decode(u8); } catch(e){}
    let s=""; for (let i=0;i<u8.length;i++) s+=String.fromCharCode(u8[i]); return s;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
    if (!msg || !msg.type) return;

    if (msg.type === "HIYORI_PING") {
      sendResponse({ videos: listVideosInfo() });
      return true;
    }

    if (msg.type === "HIYORI_LOAD_SUBS") {
      const { b64, filename, encoding, targetIndex, offsetMs } = msg.payload || {};
      const bin = Uint8Array.from(atob(b64), c=>c.charCodeAt(0)).buffer;
      const text = decodeArrayBuffer(bin, encoding);
      const format = parser.guessFormatByExt(filename);
      const cues = parser.whichParser(format, text);

      const vids = findVideosDeep(document);
      const v = (targetIndex!=null && vids[targetIndex]) ? vids[targetIndex] : vids[0];
      if (!v) { sendResponse && sendResponse({ ok:false, reason:"no_video" }); return; }
      ensureOverlay(v);
      const rec = state.videos.get(v);
      rec.cues = cues;
      rec.offset = typeof offsetMs==="number" ? offsetMs : 0;
      rec.currentIndex = -1;
      if (!v.paused) v.dispatchEvent(new Event("timeupdate"));
      applySettings(v);
      sendResponse && sendResponse({ ok:true, count:cues.length });
      return true;
    }

    if (msg.type === "HIYORI_UPDATE_SETTINGS") {
      const { targetIndex, settings } = msg.payload || {};
      const vids = findVideosDeep(document);
      const v = (targetIndex!=null && vids[targetIndex]) ? vids[targetIndex] : vids[0];
      if (!v) { sendResponse && sendResponse({ ok:false, reason:"no_video" }); return; }
      ensureOverlay(v);
      const rec = state.videos.get(v);
      Object.assign(rec.settings, settings||{});
      applySettings(v);
      sendResponse && sendResponse({ ok:true });
      return true;
    }

    if (msg.type === "HIYORI_UNLOAD") {
      const vids = findVideosDeep(document);
      const v = (msg.payload && msg.payload.targetIndex!=null && vids[msg.payload.targetIndex]) ? vids[msg.payload.targetIndex] : vids[0];
      if (!v) { sendResponse && sendResponse({ ok:false, reason:"no_video" }); return; }
      const rec = state.videos.get(v);
      if (rec) {
        rec.cues = [];
        rec.currentIndex = -1;
        if (rec.textBox) rec.textBox.innerHTML = "";
      }
      sendResponse && sendResponse({ ok:true });
      return true;
    }
  });

  // initial scan
  for (const v of findVideosDeep(document)) ensureOverlay(v);
})();
