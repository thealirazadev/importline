import { createReadStream } from "node:fs";
import { Transform } from "node:stream";
import Papa from "papaparse";
import { type Delimiter, type Encoding, isDelimiter, isEncoding } from "./detect";

/**
 * Streaming CSV reading: bytes are decoded chunk by chunk and parsed by papaparse's node
 * duplex streamer, which pauses parsing when the consumer stops reading. Nothing buffers the
 * whole file; the consumer's backpressure reaches all the way back to the file handle.
 */

const READ_CHUNK_BYTES = 64 * 1024;

/** CSV record number, counting the header as 1, matching spreadsheet row numbers. */
export type CsvRecord = { rowNumber: number; cells: string[] };

export type CsvOptions = { encoding: Encoding; delimiter: Delimiter };

/** Stored values are plain strings; narrow them once instead of at every call site. */
export function csvOptionsFor(row: { delimiter: string; encoding: string }): CsvOptions {
  return {
    delimiter: isDelimiter(row.delimiter) ? row.delimiter : ",",
    encoding: isEncoding(row.encoding) ? row.encoding : "utf-8",
  };
}

/** A record papaparse produced from a blank line: skipped without being reported. */
export function isBlankRecord(cells: string[]): boolean {
  return cells.length <= 1 && (cells[0] ?? "").trim() === "";
}

function createDecodeStream(encoding: Encoding): Transform {
  const decoder = new TextDecoder(encoding, { fatal: false });
  const push = (text: string, done: (error?: Error, chunk?: string) => void) => {
    // Empty pushes are dropped: papaparse treats an empty write as the end of input.
    if (text.length === 0) done();
    else done(undefined, text);
  };
  return new Transform({
    readableObjectMode: true,
    transform(chunk: Buffer, _encoding, done) {
      try {
        push(decoder.decode(chunk, { stream: true }), done);
      } catch (error) {
        done(error instanceof Error ? error : new Error(String(error)));
      }
    },
    flush(done) {
      try {
        push(decoder.decode(), done);
      } catch (error) {
        done(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });
}

/**
 * Yields every record in file order. `limit` stops early (the streams are torn down by the
 * generator's finally block, so an abandoned read never leaves a file handle open).
 */
export async function* readRecords(
  filePath: string,
  options: CsvOptions & { limit?: number },
): AsyncGenerator<CsvRecord> {
  const source = createReadStream(filePath, { highWaterMark: READ_CHUNK_BYTES });
  const decoder = createDecodeStream(options.encoding);
  const parser = Papa.parse(Papa.NODE_STREAM_INPUT, {
    delimiter: options.delimiter,
    skipEmptyLines: false,
  });
  source.on("error", (error: Error) => parser.destroy(error));
  decoder.on("error", (error: Error) => parser.destroy(error));
  source.pipe(decoder).pipe(parser);

  let rowNumber = 0;
  try {
    for await (const cells of parser as AsyncIterable<string[]>) {
      rowNumber += 1;
      yield { rowNumber, cells };
      if (options.limit !== undefined && rowNumber >= options.limit) break;
    }
  } finally {
    source.destroy();
    decoder.destroy();
    parser.destroy();
  }
}

/** Header row plus the first `rows` data records, for the mapping screen's sample values. */
export async function readPreview(
  filePath: string,
  options: CsvOptions & { rows: number },
): Promise<{ headers: string[]; rows: string[][] }> {
  const headers: string[] = [];
  const rows: string[][] = [];
  for await (const record of readRecords(filePath, { ...options, limit: options.rows + 1 })) {
    if (record.rowNumber === 1) {
      headers.push(...record.cells.map((header) => header.normalize("NFC").trim()));
      continue;
    }
    if (isBlankRecord(record.cells)) continue;
    rows.push(record.cells);
  }
  return { headers, rows };
}
