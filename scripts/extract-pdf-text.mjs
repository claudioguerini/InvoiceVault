import fs from "node:fs";
import zlib from "node:zlib";

function isPrintableByte(byte) {
  return (
    byte === 0x09 || // tab
    byte === 0x0a || // lf
    byte === 0x0d || // cr
    (byte >= 0x20 && byte <= 0x7e)
  );
}

function printableRatio(buf) {
  if (!buf.length) return 0;
  let printable = 0;
  for (const byte of buf) {
    if (isPrintableByte(byte)) printable += 1;
  }
  return printable / buf.length;
}

function decodeUtf16Be(bytes) {
  // bytes includes BOM 0xFE 0xFF
  const data = bytes.subarray(2);
  const codeUnits = [];
  for (let i = 0; i + 1 < data.length; i += 2) {
    codeUnits.push((data[i] << 8) | data[i + 1]);
  }
  // Chunk to avoid call stack issues.
  let out = "";
  const CHUNK = 8192;
  for (let i = 0; i < codeUnits.length; i += CHUNK) {
    out += String.fromCharCode(...codeUnits.slice(i, i + CHUNK));
  }
  return out;
}

function decodeUtf16BeNoBom(bytes) {
  const data = bytes;
  const codeUnits = [];
  for (let i = 0; i + 1 < data.length; i += 2) {
    codeUnits.push((data[i] << 8) | data[i + 1]);
  }
  let out = "";
  const CHUNK = 8192;
  for (let i = 0; i < codeUnits.length; i += CHUNK) {
    out += String.fromCharCode(...codeUnits.slice(i, i + CHUNK));
  }
  return out;
}

function parseToUnicodeMaps(pdfLatin) {
  // Best-effort parse of ToUnicode CMap streams (PowerPoint exports these often as plain text).
  const map = new Map();

  function addMapping(codeHex, unicodeHex) {
    if (!codeHex || !unicodeHex) return;
    const code = parseInt(codeHex, 16);
    if (!Number.isFinite(code)) return;
    const bytes = Buffer.from(unicodeHex, "hex");
    if (bytes.length < 2) return;
    const unicode = decodeUtf16BeNoBom(bytes);
    if (!unicode) return;
    if (!map.has(code)) {
      map.set(code, unicode);
    }
  }

  // bfchar blocks: <src> <dst>
  for (const block of pdfLatin.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const body = block[1] ?? "";
    for (const m of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      addMapping(m[1], m[2]);
    }
  }

  // bfrange blocks:
  // - <srcStart> <srcEnd> <dstStart>
  // - <srcStart> <srcEnd> [<dst1> <dst2> ...]
  for (const block of pdfLatin.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1] ?? "";

    for (const line of body.split(/\r?\n/)) {
      const mSimple = line.match(
        /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/,
      );
      if (mSimple) {
        const srcStart = parseInt(mSimple[1], 16);
        const srcEnd = parseInt(mSimple[2], 16);
        const dstBytes = Buffer.from(mSimple[3], "hex");
        if (!Number.isFinite(srcStart) || !Number.isFinite(srcEnd)) continue;
        if (dstBytes.length !== 2) continue; // keep it simple
        const dstStart = (dstBytes[0] << 8) | dstBytes[1];
        for (let c = srcStart; c <= srcEnd; c += 1) {
          const u = dstStart + (c - srcStart);
          map.set(c, String.fromCharCode(u));
        }
        continue;
      }

      const mArray = line.match(
        /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.*)\]/,
      );
      if (mArray) {
        const srcStart = parseInt(mArray[1], 16);
        const srcEnd = parseInt(mArray[2], 16);
        if (!Number.isFinite(srcStart) || !Number.isFinite(srcEnd)) continue;
        const entries = [...mArray[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((m) => m[1]);
        for (let i = 0; i < entries.length; i += 1) {
          const code = srcStart + i;
          if (code > srcEnd) break;
          const bytes = Buffer.from(entries[i], "hex");
          if (bytes.length < 2) continue;
          map.set(code, decodeUtf16BeNoBom(bytes));
        }
      }
    }
  }

  return map;
}

function decodePdfStringBytes(bytes, unicodeMap) {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes);
  }

  if (unicodeMap && unicodeMap.size > 0 && bytes.length >= 2) {
    // PowerPoint PDFs often encode text as 2-byte codes mapped via ToUnicode CMaps.
    const pairs = Math.floor(bytes.length / 2);
    let hits = 0;
    let out = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1];
      const mapped = unicodeMap.get(code);
      if (mapped !== undefined) {
        out += mapped;
        hits += 1;
        continue;
      }
      // Fallback: some strings are already UCS-2BE
      if (bytes[i] === 0x00 && bytes[i + 1] >= 0x20 && bytes[i + 1] <= 0x7e) {
        out += String.fromCharCode(bytes[i + 1]);
        hits += 1;
      }
    }

    if (hits > 0 && hits / Math.max(1, pairs) >= 0.2) {
      return out;
    }
  }

  return Buffer.from(bytes).toString("latin1");
}

function extractPdfLiteralString(buf, startIndex) {
  // buf[startIndex] === '('
  let i = startIndex + 1;
  let depth = 1;
  const out = [];

  while (i < buf.length) {
    const ch = buf[i];

    if (ch === 0x5c /* backslash */) {
      const next = buf[i + 1];
      if (next === undefined) break;

      // Line continuation: backslash followed by newline.
      if (next === 0x0d /* \r */) {
        if (buf[i + 2] === 0x0a) i += 3;
        else i += 2;
        continue;
      }
      if (next === 0x0a /* \n */) {
        i += 2;
        continue;
      }

      // Octal escape: \ddd (1-3 digits)
      if (next >= 0x30 && next <= 0x37) {
        let oct = "";
        for (let j = 1; j <= 3; j += 1) {
          const d = buf[i + j];
          if (d === undefined) break;
          if (d < 0x30 || d > 0x37) break;
          oct += String.fromCharCode(d);
        }
        if (oct.length > 0) {
          out.push(parseInt(oct, 8) & 0xff);
          i += 1 + oct.length;
          continue;
        }
      }

      // Standard escapes
      switch (next) {
        case 0x6e: // n
          out.push(0x0a);
          i += 2;
          continue;
        case 0x72: // r
          out.push(0x0d);
          i += 2;
          continue;
        case 0x74: // t
          out.push(0x09);
          i += 2;
          continue;
        case 0x62: // b
          out.push(0x08);
          i += 2;
          continue;
        case 0x66: // f
          out.push(0x0c);
          i += 2;
          continue;
        case 0x28: // (
        case 0x29: // )
        case 0x5c: // \
          out.push(next);
          i += 2;
          continue;
        default:
          // Unknown escape: keep the next char.
          out.push(next);
          i += 2;
          continue;
      }
    }

    if (ch === 0x28 /* ( */) {
      depth += 1;
      out.push(ch);
      i += 1;
      continue;
    }
    if (ch === 0x29 /* ) */) {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
      out.push(ch);
      i += 1;
      continue;
    }

    out.push(ch);
    i += 1;
  }

  return {
    valueBytes: Buffer.from(out),
    nextIndex: i,
  };
}

function extractPdfHexString(buf, startIndex) {
  // buf[startIndex] === '<' and buf[startIndex+1] !== '<'
  let i = startIndex + 1;
  let hex = "";
  while (i < buf.length) {
    const ch = buf[i];
    if (ch === 0x3e /* > */) {
      i += 1;
      break;
    }
    // ignore whitespace
    if (ch === 0x20 || ch === 0x0a || ch === 0x0d || ch === 0x09) {
      i += 1;
      continue;
    }
    hex += String.fromCharCode(ch);
    i += 1;
  }

  const clean = hex.replace(/[^0-9A-Fa-f]/g, "");
  const padded = clean.length % 2 === 1 ? clean + "0" : clean;
  const bytes = [];
  for (let j = 0; j < padded.length; j += 2) {
    bytes.push(parseInt(padded.slice(j, j + 2), 16) & 0xff);
  }

  return {
    valueBytes: Buffer.from(bytes),
    nextIndex: i,
  };
}

function extractTextFromTextBlock(textBlockBuf, unicodeMap) {
  const parts = [];
  let i = 0;

  while (i < textBlockBuf.length) {
    const ch = textBlockBuf[i];
    if (ch === 0x28 /* ( */) {
      const { valueBytes, nextIndex } = extractPdfLiteralString(textBlockBuf, i);
      parts.push(decodePdfStringBytes(valueBytes, unicodeMap));
      i = nextIndex;
      continue;
    }

    if (ch === 0x3c /* < */ && textBlockBuf[i + 1] !== 0x3c /* << */) {
      const { valueBytes, nextIndex } = extractPdfHexString(textBlockBuf, i);
      const decoded = decodePdfStringBytes(valueBytes, unicodeMap);
      if (decoded) parts.push(decoded);
      i = nextIndex;
      continue;
    }

    i += 1;
  }

  const joined = parts.join("");
  return joined.replace(/\s+/g, " ").trim();
}

function findTextBlocks(streamBuf) {
  const blocks = [];
  const bt = Buffer.from("BT", "ascii");
  const et = Buffer.from("ET", "ascii");

  let cursor = 0;
  while (cursor < streamBuf.length) {
    const btIndex = streamBuf.indexOf(bt, cursor);
    if (btIndex === -1) break;
    const etIndex = streamBuf.indexOf(et, btIndex + 2);
    if (etIndex === -1) break;
    blocks.push(streamBuf.subarray(btIndex + 2, etIndex));
    cursor = etIndex + 2;
  }
  return blocks;
}

function* iterPdfStreams(pdfBuf) {
  const pdfLatin = pdfBuf.toString("latin1");
  let pos = 0;
  while (true) {
    const streamIdx = pdfLatin.indexOf("stream", pos);
    if (streamIdx === -1) break;
    const endIdx = pdfLatin.indexOf("endstream", streamIdx);
    if (endIdx === -1) break;

    // Extract the dictionary right before the stream (best-effort).
    const lookbackStart = Math.max(0, streamIdx - 4096);
    const dictStart = pdfLatin.lastIndexOf("<<", streamIdx);
    const dictEnd = pdfLatin.lastIndexOf(">>", streamIdx);
    const dict =
      dictStart !== -1 &&
      dictEnd !== -1 &&
      dictStart >= lookbackStart &&
      dictEnd > dictStart
        ? pdfLatin.slice(dictStart, dictEnd + 2)
        : "";

    let dataStart = streamIdx + "stream".length;
    if (pdfLatin[dataStart] === "\r" && pdfLatin[dataStart + 1] === "\n") dataStart += 2;
    else if (pdfLatin[dataStart] === "\n") dataStart += 1;

    let dataEnd = endIdx;
    if (pdfLatin[dataEnd - 1] === "\n" && pdfLatin[dataEnd - 2] === "\r") dataEnd -= 2;
    else if (pdfLatin[dataEnd - 1] === "\n") dataEnd -= 1;

    const raw = pdfBuf.subarray(dataStart, dataEnd);
    const isFlate = dict.includes("/FlateDecode");

    yield { dict, raw, isFlate };
    pos = endIdx + "endstream".length;
  }
}

function main() {
  const inputPath = process.argv[2] ?? "docs/InvoiceVault-slides.pdf";
  const outputPath = process.argv[3] ?? "docs/InvoiceVault-slides.extracted.txt";

  const pdfBuf = fs.readFileSync(inputPath);
  const unicodeMap = parseToUnicodeMaps(pdfBuf.toString("latin1"));

  const extracted = [];
  let streamIndex = 0;
  let kept = 0;

  for (const stream of iterPdfStreams(pdfBuf)) {
    streamIndex += 1;
    if (!stream.isFlate) continue;

    let inflated;
    try {
      inflated = zlib.inflateSync(stream.raw);
    } catch {
      continue;
    }

    const ratio = printableRatio(inflated);
    if (ratio < 0.75) continue;

    const hasBT = inflated.includes(Buffer.from("BT", "ascii"));
    const hasET = inflated.includes(Buffer.from("ET", "ascii"));
    if (!hasBT || !hasET) continue;

    const blocks = findTextBlocks(inflated);
    const texts = blocks
      .map((block) => extractTextFromTextBlock(block, unicodeMap))
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s.length >= 3)
      .filter((s) => /[A-Za-zÀ-ÿ]/.test(s));
    if (texts.length === 0) continue;

    kept += 1;
    extracted.push(
      `# Stream ${streamIndex}\n` +
        `printable_ratio=${ratio.toFixed(3)}\n` +
        texts.map((t) => `- ${t}`).join("\n") +
        "\n",
    );
  }

  const header =
    `# Extracted Text From Slides\n` +
    `source=${inputPath}\n` +
    `streams_with_text=${kept}\n` +
    `\n`;

  fs.writeFileSync(outputPath, header + extracted.join("\n"), "utf8");
  // eslint-disable-next-line no-console
  console.log(`Wrote: ${outputPath}`);
}

main();
