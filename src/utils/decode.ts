import Encoding from 'encoding-japanese';

export interface DecodeResult {
  text: string;
  encoding: string;
  hasBom: boolean;
  garbledText?: string;
}

export function detectAndDecode(bytes: Uint8Array): DecodeResult {
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    const text = new TextDecoder('utf-8').decode(bytes.slice(3));
    return { text, encoding: 'UTF-8', hasBom: true };
  }

  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    const text = new TextDecoder('utf-16le').decode(bytes.slice(2));
    const garbledText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return { text, encoding: 'UTF-16LE', hasBom: true, garbledText };
  }

  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    const text = new TextDecoder('utf-16be').decode(bytes.slice(2));
    const garbledText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return { text, encoding: 'UTF-16BE', hasBom: true, garbledText };
  }

  const detected = Encoding.detect(bytes);

  if (detected === 'SJIS' || detected === 'EUCJP' || detected === 'JIS') {
    const unicodeArray = Encoding.convert(bytes, {
      to: 'UNICODE',
      from: detected,
    });
    const text = Encoding.codeToString(unicodeArray);
    const garbledText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const encodingName = detected === 'SJIS' ? 'Shift_JIS' : detected === 'EUCJP' ? 'EUC-JP' : 'ISO-2022-JP';
    return { text, encoding: encodingName, hasBom: false, garbledText };
  }

  const text = new TextDecoder('utf-8').decode(bytes);
  return { text, encoding: 'UTF-8', hasBom: false };
}

export function readFileAsArrayBuffer(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
      } else {
        reject(new Error('Failed to read file as ArrayBuffer'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
