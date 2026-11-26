/**
 * PNG 人物卡元数据读写（不依赖第三方库）
 * 规范依据：PNG 规范 tEXt/zTXt/iTXt 文本块；
 * SillyTavern 约定：关键字 `chara` 存放 base64(JSON)，V3 另外使用 `ccv3`。
 */

import type { CardImageInfo } from './types';
import { base64ToBytes, base64ToUtf8, bytesToBase64, utf8ToBase64 } from './util';

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/* ------------------------------------------------------------------ CRC32 */

let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

export function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ 解析 */

export interface PngChunk {
  type: string;
  data: Uint8Array;
  keyword?: string;
  text?: string;
  rawStart: number;
}

export interface PngInfo {
  width: number;
  height: number;
  chunks: PngChunk[];
  textChunks: { keyword: string; text: string; type: string }[];
  /** 人物卡相关块（解码后的 JSON 文本） */
  cardChunks: { keyword: string; json: string; spec?: string; specVersion?: string }[];
}

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  return SIG.every((b, i) => bytes[i] === b);
}

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');

function readU32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

export async function readPngInfo(bytes: Uint8Array): Promise<PngInfo> {
  if (!isPng(bytes)) throw new Error('不是有效的 PNG 文件（文件头签名不匹配）');
  const chunks: PngChunk[] = [];
  const textChunks: { keyword: string; text: string; type: string }[] = [];
  let width = 0;
  let height = 0;
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = readU32(bytes, pos);
    const type = latin1.decode(bytes.subarray(pos + 4, pos + 8));
    const dataStart = pos + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length) break;
    const data = bytes.subarray(dataStart, dataEnd);
    const chunk: PngChunk = { type, data, rawStart: pos };
    if (type === 'IHDR' && len >= 8) {
      width = readU32(data, 0);
      height = readU32(data, 4);
    } else if (type === 'tEXt') {
      const zero = data.indexOf(0);
      if (zero > 0) {
        const keyword = latin1.decode(data.subarray(0, zero));
        const text = latin1.decode(data.subarray(zero + 1));
        chunk.keyword = keyword;
        chunk.text = text;
        textChunks.push({ keyword, text, type: 'tEXt' });
      }
    } else if (type === 'zTXt') {
      const zero = data.indexOf(0);
      if (zero > 0) {
        const keyword = latin1.decode(data.subarray(0, zero));
        const method = data[zero + 1];
        if (method === 0) {
          try {
            const text = await inflate(data.subarray(zero + 2));
            chunk.keyword = keyword;
            chunk.text = text;
            textChunks.push({ keyword, text, type: 'zTXt' });
          } catch {
            textChunks.push({ keyword, text: '[zTXt 解压失败]', type: 'zTXt' });
          }
        }
      }
    } else if (type === 'iTXt') {
      const zero = data.indexOf(0);
      if (zero > 0) {
        const keyword = latin1.decode(data.subarray(0, zero));
        const compFlag = data[zero + 1];
        let p = zero + 3;
        // 跳过 langTag 与 translatedKeyword
        for (let i = 0; i < 2; i++) {
          const z = data.indexOf(0, p);
          if (z < 0) break;
          p = z + 1;
        }
        const payload = data.subarray(p);
        try {
          const text = compFlag ? await inflate(payload) : utf8.decode(payload);
          chunk.keyword = keyword;
          chunk.text = text;
          textChunks.push({ keyword, text, type: 'iTXt' });
        } catch {
          textChunks.push({ keyword, text: '[iTXt 解码失败]', type: 'iTXt' });
        }
      }
    }
    chunks.push(chunk);
    pos = dataEnd + 4; // 跳过 CRC
    if (type === 'IEND') break;
  }

  const cardChunks: PngInfo['cardChunks'] = [];
  for (const t of textChunks) {
    const kw = t.keyword.toLowerCase();
    if (kw !== 'chara' && kw !== 'ccv3') continue;
    try {
      const jsonText = base64ToUtf8(t.text.trim());
      const parsed = JSON.parse(jsonText);
      cardChunks.push({
        keyword: t.keyword,
        json: jsonText,
        spec: typeof parsed?.spec === 'string' ? parsed.spec : undefined,
        specVersion: typeof parsed?.spec_version === 'string' ? parsed.spec_version : undefined,
      });
    } catch {
      cardChunks.push({ keyword: t.keyword, json: '', spec: undefined, specVersion: undefined });
    }
  }

  return { width, height, chunks, textChunks, cardChunks };
}

async function inflate(data: Uint8Array): Promise<string> {
  const ds = new DecompressionStream('deflate');
  const blobPart = new Uint8Array(data);
  const stream = new Blob([blobPart]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new TextDecoder('utf-8').decode(buf);
}

export function bytesToDataUrl(bytes: Uint8Array, mime = 'image/png'): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

export async function readPngCard(bytes: Uint8Array, fileName?: string): Promise<{ info: PngInfo; image: CardImageInfo }> {
  const info = await readPngInfo(bytes);
  if (!info.cardChunks.length) {
    throw new Error('该 PNG 中没有找到人物卡元数据块（chara / ccv3）。可能是普通图片，或元数据已被压缩工具移除。');
  }
  const image: CardImageInfo = {
    dataUrl: bytesToDataUrl(bytes),
    mime: 'image/png',
    fileName,
    width: info.width,
    height: info.height,
    metaChunks: info.cardChunks,
    otherChunks: info.textChunks.filter((t) => !/^(chara|ccv3)$/i.test(t.keyword)).map((t) => ({ keyword: t.keyword, text: t.text })),
  };
  return { info, image };
}

/* ------------------------------------------------------------------ 写入 */

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

function textChunk(keyword: string, text: string): Uint8Array {
  const k = new TextEncoder().encode(keyword);
  const t = new TextEncoder().encode(text); // base64 为 ASCII，等价 latin1
  const data = new Uint8Array(k.length + 1 + t.length);
  data.set(k, 0);
  data[k.length] = 0;
  data.set(t, k.length + 1);
  return makeChunk('tEXt', data);
}

export interface WritePngOptions {
  /** 写入 ccv3 块（V3 元数据），默认按卡片版本决定 */
  writeCcv3?: boolean;
  /** 是否保留原 PNG 中已有的 chara/ccv3 块（默认替换） */
  keepExisting?: boolean;
}

/**
 * 把人物卡 JSON 写入 PNG。所有非人物卡块原样保留（字节级复制，含 CRC）。
 */
export function writeCardToPng(original: Uint8Array, cardJson: any, opts: WritePngOptions = {}): Uint8Array {
  if (!isPng(original)) throw new Error('源文件不是 PNG，无法写入人物卡元数据');
  const jsonText = JSON.stringify(cardJson);
  const b64 = utf8ToBase64(jsonText);
  const spec = typeof cardJson?.spec === 'string' ? cardJson.spec : '';
  const writeCcv3 = opts.writeCcv3 ?? spec === 'chara_card_v3';

  const pieces: Uint8Array[] = [new Uint8Array(SIG)];
  let pos = 8;
  let insertedBeforeIend = false;
  const newChunks: Uint8Array[] = [textChunk('chara', b64)];
  if (writeCcv3) newChunks.push(textChunk('ccv3', b64));

  while (pos + 8 <= original.length) {
    const len = readU32(original, pos);
    const type = latin1.decode(original.subarray(pos + 4, pos + 8));
    const end = pos + 8 + len + 4;
    if (end > original.length) break;
    const isCardChunk =
      (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') &&
      (() => {
        const zero = original.indexOf(0, pos + 8);
        if (zero < 0 || zero > pos + 8 + len) return false;
        const kw = latin1.decode(original.subarray(pos + 8, zero)).toLowerCase();
        return kw === 'chara' || kw === 'ccv3';
      })();

    if (type === 'IEND') {
      if (!insertedBeforeIend) {
        for (const c of newChunks) pieces.push(c);
        insertedBeforeIend = true;
      }
      pieces.push(original.subarray(pos, end));
      break;
    }
    if (isCardChunk && !opts.keepExisting) {
      // 丢弃旧的人物卡块
    } else {
      pieces.push(original.subarray(pos, end));
    }
    pos = end;
  }

  const total = pieces.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of pieces) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** 从 base64 dataURL 还原字节 */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const idx = dataUrl.indexOf(',');
  return base64ToBytes(dataUrl.slice(idx + 1));
}
