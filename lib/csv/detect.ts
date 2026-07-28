import Papa from "papaparse";

/** Encoding and delimiter detection over a bounded sample. Rules: docs/architecture.md. */

export const ENCODINGS = ["utf-8", "utf-16le", "utf-16be", "windows-1252"] as const;
export type Encoding = (typeof ENCODINGS)[number];

/** Candidates in precedence order; ties in the delimiter score break by this order. */
export const DELIMITERS = [",", ";", "\t", "|"] as const;
export type Delimiter = (typeof DELIMITERS)[number];

export const SAMPLE_BYTES = 64 * 1024;
const PREVIEW_RECORDS = 50;

export type Detection = {
  encoding: Encoding;
  delimiter: Delimiter;
  delimiterUncertain: boolean;
  headers: string[];
};

export function isEncoding(value: string): value is Encoding {
  return (ENCODINGS as readonly string[]).includes(value);
}

export function isDelimiter(value: string): value is Delimiter {
  return (DELIMITERS as readonly string[]).includes(value);
}

/** Drops a multi-byte UTF-8 sequence cut in half by the sample boundary. */
function trimTrailingPartialUtf8(sample: Buffer): Buffer {
  for (let back = 1; back <= 3 && back <= sample.length; back += 1) {
    const byte = sample[sample.length - back];
    if (byte < 0x80) return sample;
    if (byte >= 0xc0) {
      const needed = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : 2;
      return back < needed ? sample.subarray(0, sample.length - back) : sample;
    }
  }
  return sample;
}

export function detectEncoding(sample: Buffer): Encoding {
  if (sample.length >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) {
    return "utf-8";
  }
  if (sample.length >= 2 && sample[0] === 0xff && sample[1] === 0xfe) return "utf-16le";
  if (sample.length >= 2 && sample[0] === 0xfe && sample[1] === 0xff) return "utf-16be";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(trimTrailingPartialUtf8(sample));
    return "utf-8";
  } catch {
    // windows-1252 maps all 256 byte values, so it cannot fail.
    return "windows-1252";
  }
}

/** Lenient decode with the BOM stripped; invalid sequences become U+FFFD. */
export function decodeSample(sample: Buffer, encoding: Encoding): string {
  const text = new TextDecoder(encoding, { fatal: false }).decode(sample);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** The sample can end mid-record; only whole lines are scored. */
function dropTrailingPartialRecord(text: string): string {
  const lastBreak = text.lastIndexOf("\n");
  return lastBreak === -1 ? text : text.slice(0, lastBreak + 1);
}

function scoreDelimiter(text: string, delimiter: Delimiter): number {
  const parsed = Papa.parse<string[]>(text, {
    delimiter,
    preview: PREVIEW_RECORDS,
    skipEmptyLines: "greedy",
  });
  const counts = new Map<number, number>();
  for (const record of parsed.data) {
    counts.set(record.length, (counts.get(record.length) ?? 0) + 1);
  }
  let modalColumns = 0;
  let modalRecords = 0;
  for (const [columns, records] of counts) {
    if (records > modalRecords || (records === modalRecords && columns > modalColumns)) {
      modalColumns = columns;
      modalRecords = records;
    }
  }
  // A single column means the delimiter never appeared: not a qualifying candidate.
  return modalColumns >= 2 ? modalRecords : 0;
}

export function detectDelimiter(text: string): { delimiter: Delimiter; uncertain: boolean } {
  const body = dropTrailingPartialRecord(text) || text;
  let best: Delimiter | null = null;
  let bestScore = 0;
  for (const candidate of DELIMITERS) {
    const score = scoreDelimiter(body, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best === null
    ? { delimiter: ",", uncertain: true }
    : { delimiter: best, uncertain: false };
}

export function readHeaders(text: string, delimiter: Delimiter): string[] {
  const parsed = Papa.parse<string[]>(dropTrailingPartialRecord(text) || text, {
    delimiter,
    preview: 1,
    skipEmptyLines: "greedy",
  });
  const first = parsed.data[0] ?? [];
  return first.map((header) => header.normalize("NFC").trim());
}

export function detectFromSample(sample: Buffer): Detection {
  const encoding = detectEncoding(sample);
  const text = decodeSample(sample, encoding);
  const { delimiter, uncertain } = detectDelimiter(text);
  return {
    encoding,
    delimiter,
    delimiterUncertain: uncertain,
    headers: readHeaders(text, delimiter),
  };
}
