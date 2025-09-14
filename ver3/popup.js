
let optionsMap = []; // [{frameId, videoIndex}]

async function getActiveTabId() {
  return new Promise(resolve => {
    chrome.tabs.query({active: true, currentWindow: true}, tabs => {
      resolve(tabs && tabs[0] ? tabs[0].id : null);
    });
  });
}

function sendToFrame(tabId, frameId, message) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, message, {frameId}, resp => resolve(resp));
  });
}

async function listAllFrames(tabId) {
  return new Promise(resolve => {
    chrome.webNavigation.getAllFrames({tabId}, frames => resolve(frames || []));
  });
}

async function refreshVideoList() {
  const tabId = await getActiveTabId();
  if (!tabId) return;
  const frames = await listAllFrames(tabId);
  const sel = document.getElementById("videoSelect");
  sel.innerHTML = ""; optionsMap = [];

  for (const fr of frames) {
    let resp = await sendToFrame(tabId, fr.frameId, { type: "HIYORI_PING" });
    const videos = (resp && resp.videos) || [];
    videos.forEach(v => {
      const label = `frame ${fr.frameId} • #${v.index} ${v.width}×${v.height}${v.playing ? " ▶" : ""}`;
      const opt = document.createElement("option");
      opt.value = String(optionsMap.length);
      opt.textContent = label;
      sel.appendChild(opt);
      optionsMap.push({ frameId: fr.frameId, videoIndex: v.index });
    });
  }

  if (!optionsMap.length) {
    const opt = document.createElement("option");
    opt.value = "-1";
    opt.textContent = "비디오를 찾지 못했어";
    sel.appendChild(opt);
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>{
      const u8 = new Uint8Array(reader.result);
      let b64 = "";
      for (let i=0; i<u8.length; i++) b64 += String.fromCharCode(u8[i]);
      resolve(btoa(b64));
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

async function loadSubs() {
  const tabId = await getActiveTabId();
  if (!tabId) return;
  const file = document.getElementById("fileInput").files[0];
  if (!file) { alert("자막 파일을 선택해줘."); return; }
  const b64 = await readFileAsBase64(file);
  const encoding = document.getElementById("encoding").value;
  const off = parseInt(document.getElementById("offset").value, 10) || 0;
  const selIdx = parseInt(document.getElementById("videoSelect").value, 10);

  if (selIdx < 0 || !optionsMap[selIdx]) { alert("대상 비디오가 없네… 새로고침해줘."); return; }
  const { frameId, videoIndex } = optionsMap[selIdx];

  const resp = await sendToFrame(tabId, frameId, {
    type: "HIYORI_LOAD_SUBS",
    payload: { b64, filename: file.name, encoding, targetIndex: videoIndex, offsetMs: off }
  });
  if (!resp || !resp.ok) alert("자막 적용에 실패했어… 페이지의 비디오를 확인해줘.");
}

async function unloadSubs() {
  const tabId = await getActiveTabId();
  if (!tabId) return;
  const selIdx = parseInt(document.getElementById("videoSelect").value, 10);
  if (selIdx < 0 || !optionsMap[selIdx]) return;
  const { frameId, videoIndex } = optionsMap[selIdx];
  await sendToFrame(tabId, frameId, { type: "HIYORI_UNLOAD", payload: { targetIndex: videoIndex } });
}

async function pushSettings() {
  const tabId = await getActiveTabId();
  if (!tabId) return;
  const selIdx = parseInt(document.getElementById("videoSelect").value, 10);
  if (selIdx < 0 || !optionsMap[selIdx]) return;
  const { frameId, videoIndex } = optionsMap[selIdx];
  const settings = {
    font: document.getElementById("font").value,
    fontSize: parseInt(document.getElementById("fontSize").value, 10) || 32,
    color: document.getElementById("color").value,
    bgColor: document.getElementById("bgColor").value,
    bgOpacity: parseFloat(document.getElementById("bgOpacity").value) || 0.35,
    textShadow: document.getElementById("textShadow").checked,
    visible: document.getElementById("visible").checked
  };
  await sendToFrame(tabId, optionsMap[selIdx].frameId, {
    type: "HIYORI_UPDATE_SETTINGS",
    payload: { targetIndex: videoIndex, settings }
  });
}

document.addEventListener("DOMContentLoaded", ()=>{
  refreshVideoList();
  document.getElementById("refreshBtn").addEventListener("click", refreshVideoList);
  document.getElementById("loadBtn").addEventListener("click", loadSubs);
  document.getElementById("unloadBtn").addEventListener("click", unloadSubs);
  const ids = ["font","fontSize","color","bgColor","bgOpacity","textShadow","visible"];
  for (const id of ids) {
    document.getElementById(id).addEventListener("input", (e)=>{
      if (id === "bgOpacity") document.getElementById("bgOpacityVal").textContent = e.target.value;
      clearTimeout(window.__hiyoriStyleTimer);
      window.__hiyoriStyleTimer = setTimeout(pushSettings, 120);
    });
  }
});
