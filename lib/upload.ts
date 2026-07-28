import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { open, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { SAMPLE_BYTES } from "./csv/detect";

/**
 * Streaming multipart/form-data reader. The file part goes straight to disk while the hash,
 * byte counter, and detection sample are maintained incrementally, so memory stays bounded
 * regardless of upload size. Small text fields are capped.
 */

const FIELD_MAX_BYTES = 4096;
const HEADER_MAX_BYTES = 8192;

export class UploadTooLargeError extends Error {}
export class MalformedUploadError extends Error {}

export type ReceivedFile = {
  originalFilename: string;
  tempPath: string;
  sizeBytes: number;
  sha256: string;
  sample: Buffer;
};

export type ReceivedUpload = {
  fields: Record<string, string>;
  file: ReceivedFile | null;
};

export function parseBoundary(contentType: string | null): string | null {
  if (!contentType || !contentType.toLowerCase().startsWith("multipart/form-data")) return null;
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = (match?.[1] ?? match?.[2] ?? "").trim();
  return boundary.length > 0 ? boundary : null;
}

function partName(headerText: string): { name: string; filename: string | null } | null {
  const disposition = headerText
    .split("\r\n")
    .find((line) => line.toLowerCase().startsWith("content-disposition:"));
  if (!disposition) return null;
  const name = /name="([^"]*)"/i.exec(disposition)?.[1];
  if (name === undefined) return null;
  const filename = /filename="([^"]*)"/i.exec(disposition)?.[1];
  return { name, filename: filename === undefined ? null : filename };
}

type FileSink = {
  handle: Awaited<ReturnType<typeof open>>;
  closed: boolean;
  hash: ReturnType<typeof createHash>;
  sample: Buffer[];
  sampleBytes: number;
  bytes: number;
  tempPath: string;
  filename: string;
};

export async function receiveUpload(
  request: Request,
  options: { tempDir: string; maxBytes: number },
): Promise<ReceivedUpload> {
  const boundary = parseBoundary(request.headers.get("content-type"));
  if (boundary === null) throw new MalformedUploadError("missing multipart boundary");
  if (request.body === null) throw new MalformedUploadError("missing request body");

  await mkdir(options.tempDir, { recursive: true });

  const delimiter = Buffer.from(`\r\n--${boundary}`);
  const opening = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  let file: FileSink | null = null;
  let fieldName: string | null = null;
  let fieldChunks: Buffer[] = [];
  let fieldBytes = 0;
  let current: "file" | "field" | null = null;
  let state: "boundary" | "headers" | "body" | "after" | "done" = "boundary";
  let buffer = Buffer.alloc(0);

  const closeFile = async () => {
    if (file && !file.closed) {
      file.closed = true;
      await file.handle.close();
    }
  };
  const discardFile = async () => {
    if (!file) return;
    const temp = file.tempPath;
    await closeFile();
    file = null;
    await unlink(temp).catch(() => undefined);
  };

  const writeBody = async (chunk: Buffer) => {
    if (chunk.length === 0) return;
    if (current === "file" && file) {
      if (file.bytes + chunk.length > options.maxBytes) {
        throw new UploadTooLargeError("upload exceeds the configured size cap");
      }
      file.bytes += chunk.length;
      file.hash.update(chunk);
      if (file.sampleBytes < SAMPLE_BYTES) {
        const take = chunk.subarray(0, SAMPLE_BYTES - file.sampleBytes);
        file.sample.push(take);
        file.sampleBytes += take.length;
      }
      await file.handle.write(chunk);
      return;
    }
    if (current === "field" && fieldName !== null) {
      fieldBytes += chunk.length;
      if (fieldBytes > FIELD_MAX_BYTES) {
        throw new MalformedUploadError(`form field ${fieldName} is too large`);
      }
      fieldChunks.push(chunk);
    }
  };

  const finishPart = async () => {
    if (current === "file") await closeFile();
    if (current === "field" && fieldName !== null) {
      fields[fieldName] = Buffer.concat(fieldChunks).toString("utf8");
      fieldName = null;
      fieldChunks = [];
      fieldBytes = 0;
    }
    current = null;
  };

  try {
    for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
      buffer =
        buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffer, Buffer.from(chunk)]);
      let progressed = true;
      while (progressed && state !== "done") {
        progressed = false;
        if (state === "boundary") {
          const at = buffer.indexOf(opening);
          if (at !== -1 && buffer.length >= at + opening.length + 2) {
            const next = buffer.subarray(at + opening.length, at + opening.length + 2).toString();
            buffer = buffer.subarray(at + opening.length + 2);
            state = next === "--" ? "done" : "headers";
            progressed = true;
          }
        } else if (state === "headers") {
          const end = buffer.indexOf("\r\n\r\n");
          if (end === -1) {
            if (buffer.length > HEADER_MAX_BYTES) {
              throw new MalformedUploadError("part headers too large");
            }
          } else {
            const headerText = buffer.subarray(0, end).toString("utf8");
            buffer = buffer.subarray(end + 4);
            const info = partName(headerText);
            if (info === null) throw new MalformedUploadError("part is missing a name");
            if (info.filename !== null) {
              if (file !== null) throw new MalformedUploadError("only one file part is supported");
              const tempPath = path.join(options.tempDir, `${randomUUID()}.part`);
              current = "file";
              file = {
                handle: await open(tempPath, "w"),
                closed: false,
                hash: createHash("sha256"),
                sample: [],
                sampleBytes: 0,
                bytes: 0,
                tempPath,
                filename: info.filename,
              };
            } else {
              current = "field";
              fieldName = info.name;
            }
            state = "body";
            progressed = true;
          }
        } else if (state === "body") {
          const at = buffer.indexOf(delimiter);
          if (at === -1) {
            const keep = delimiter.length - 1;
            if (buffer.length > keep) {
              await writeBody(buffer.subarray(0, buffer.length - keep));
              buffer = buffer.subarray(buffer.length - keep);
            }
          } else {
            await writeBody(buffer.subarray(0, at));
            buffer = buffer.subarray(at + delimiter.length);
            await finishPart();
            state = "after";
            progressed = true;
          }
        } else if (state === "after") {
          if (buffer.length >= 2) {
            const next = buffer.subarray(0, 2).toString();
            buffer = buffer.subarray(2);
            state = next === "--" ? "done" : "headers";
            progressed = true;
          }
        }
      }
    }
  } catch (error) {
    await discardFile();
    throw error;
  }

  if (state !== "done") {
    await discardFile();
    throw new MalformedUploadError("upload ended before the closing boundary");
  }
  await closeFile();

  return {
    fields,
    file: file
      ? {
          originalFilename: file.filename,
          tempPath: file.tempPath,
          sizeBytes: file.bytes,
          sha256: file.hash.digest("hex"),
          sample: Buffer.concat(file.sample),
        }
      : null,
  };
}
