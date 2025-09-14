
// ---- Subtitle Parsing Utilities ----
function parseTimeSRT(t) {
  const m = t.trim().match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
  if (!m) return 0;
  const h = parseInt(m[1], 10) || 0;
  const min = parseInt(m[2], 10) || 0;
  const s = parseInt(m[3], 10) || 0;
  const ms = parseInt(m[4].padEnd(3,"0"), 10) || 0;
  return h*3600 + min*60 + s + ms/1000;
}
function parseTimeASS(t) {
  const m = t.trim().match(/(\d+):(\d{2}):(\d{2})\.(\d{1,2})/);
  if (!m) return 0;
  const h = parseInt(m[1], 10) || 0;
  const min = parseInt(m[2], 10) || 0;
  const s = parseInt(m[3], 10) || 0;
  const cs = parseInt(m[4], 10) || 0;
  return h*3600 + min*60 + s + cs/100;
}
function sanitizeToHTML(text) {
  const esc = text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return esc
    .replace(/&lt;br\s*\/?&gt;/gi, "<br>")
    .replace(/\{\s*\\N\s*\}/g, "<br>")
    .replace(/\\N/g, "<br>")
    .replace(/&lt;i&gt;/gi, "<i>").replace(/&lt;\/i&gt;/gi, "</i>")
    .replace(/&lt;b&gt;/gi, "<b>").replace(/&lt;\/b&gt;/gi, "</b>")
    .replace(/&lt;u&gt;/gi, "<u>").replace(/&lt;\/u&gt;/gi, "</u>");
}
function parseSRT(text) {
  const blocks = text.replace(/\r/g,"").split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;
    let i = 0;
    if (/^\d+$/.test(lines[0].trim())) i = 1;
    const tl = lines[i] || "";
    const tm = tl.match(/(.+?)\s*-->\s*(.+)/);
    if (!tm) continue;
    const start = parseTimeSRT(tm[1]);
    const end = parseTimeSRT(tm[2]);
    const textLines = lines.slice(i+1).join("\n");
    const html = sanitizeToHTML(textLines);
    cues.push({ start, end, text: html });
  }
  return cues.sort((a,b)=>a.start-b.start);
}
function parseSMI(text) {
  const src = text.replace(/\r/g,"").replace(/<br\s*\/?>/gi, "<br>");
  const cues = [];
  const re = /<sync[^>]*start\s*=\s*(\d+)[^>]*>([\s\S]*?)(?=<sync\b|<\/body>|\Z)/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const startMs = parseInt(m[1], 10) || 0;
    const body = m[2] || "";
    const only = body
      .replace(/<!--([\s\S]*?)-->/g, "")
      .replace(/<font[^>]*>/gi, "")
      .replace(/<\/font>/gi, "")
      .replace(/<p[^>]*>/gi, "")
      .replace(/<\/p>/gi, "")
      .trim();
    const html = sanitizeToHTML(only);
    const start = startMs / 1000;
    cues.push({ start, end: start + 5, text: html });
  }
  for (let i=0; i<cues.length; i++) {
    if (i < cues.length-1) cues[i].end = Math.max(cues[i].start, cues[i+1].start - 0.001);
    else cues[i].end = cues[i].start + 5;
  }
  return cues;
}
function parseASS(text) {
  const lines = text.replace(/\r/g,"").split("\n");
  let order = ["Layer","Start","End","Style","Name","MarginL","MarginR","MarginV","Effect","Text"];
  const fmtLine = lines.find(l=>/^\s*Format:/i.test(l));
  if (fmtLine) {
    const fmt = fmtLine.split(":")[1].split(",").map(s=>s.trim());
    if (fmt && fmt.length) order = fmt;
  }
  const getIndex = (key) => order.findIndex(k=>k.toLowerCase()===key.toLowerCase());
  const iStart = getIndex("Start"), iEnd = getIndex("End"), iText = getIndex("Text");
  const cues = [];
  for (const l of lines) {
    if (!/^\s*Dialogue\s*:/i.test(l)) continue;
    const after = l.split(":")[1];
    let fields = [];
    if (iText > 0) {
      let idx = 0, start = 0, count = 0;
      while (idx < after.length && count < iText) {
        if (after[idx] === ",") { fields.push(after.slice(start, idx)); start = idx+1; count++; }
        idx++;
      }
      fields.push(after.slice(start));
    } else fields = after.split(",");
    const startStr = (fields[iStart]||"").trim();
    const endStr = (fields[iEnd]||"").trim();
    let txt = (fields[iText]||"").trim();
    txt = txt.replace(/\\N/g, "<br>").replace(/\{\\.*?\}/g, "");
    const start = parseTimeASS(startStr);
    const end = parseTimeASS(endStr);
    const html = sanitizeToHTML(txt);
    cues.push({ start, end, text: html });
  }
  return cues.sort((a,b)=>a.start-b.start);
}
function guessFormatByExt(filename) {
  const lower = (filename||"").toLowerCase();
  if (lower.endsWith(".srt")) return "srt";
  if (lower.endsWith(".ass") || lower.endsWith(".ssa")) return "ass";
  if (lower.endsWith(".smi") || lower.endsWith(".sami")) return "smi";
  return "auto";
}
function whichParser(format, text) {
  const f = (format||"auto").toLowerCase();
  if (f === "srt") return parseSRT(text);
  if (f === "ass" || f === "ssa") return parseASS(text);
  if (f === "smi" || f === "sami") return parseSMI(text);
  if (/^\s*\d+\s*\n\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3}\s*-->\s*/m.test(text)) return parseSRT(text);
  if (/^\s*\[Script Info\]/m.test(text) || /^\s*Dialogue\s*:/m.test(text)) return parseASS(text);
  if (/^\s*<\s*sync\b/i.test(text) || /<\s*body\b/i.test(text)) return parseSMI(text);
  return parseSRT(text);
}
window.HiyoriSubParser = { parseSRT, parseSMI, parseASS, whichParser, guessFormatByExt };
