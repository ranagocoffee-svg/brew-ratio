"use strict";

const zlib = require("zlib");

/**
 * Minimal ZIP reader: extracts every entry from a ZIP archive buffer into
 * { [filename]: Buffer }. Supports the two compression methods DART's
 * corpCode.xml download actually uses (0 = stored, 8 = deflate); no external
 * dependency needed since Node's zlib already does raw inflate.
 */
function readZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset === -1) {
    throw new Error("Not a valid ZIP file (End Of Central Directory record not found)");
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  const entries = {};
  let offset = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x02014b50) {
      throw new Error(`Unexpected central directory signature at offset ${offset}`);
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);

    const data = readLocalFileData(buffer, localHeaderOffset, compressionMethod, compressedSize);
    entries[fileName] = data;

    offset += 46 + fileNameLength + extraFieldLength + commentLength;
  }

  return entries;
}

function readLocalFileData(buffer, localHeaderOffset, compressionMethod, compressedSize) {
  const signature = buffer.readUInt32LE(localHeaderOffset);
  if (signature !== 0x04034b50) {
    throw new Error(`Unexpected local file header signature at offset ${localHeaderOffset}`);
  }
  const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraFieldLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraFieldLength;
  const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) return Buffer.from(compressed);
  if (compressionMethod === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
}

function findEndOfCentralDirectory(buffer) {
  // EOCD is near the end of the file and has no fixed offset (a trailing
  // comment field can follow it), so scan backward for its signature.
  const signature = 0x06054b50;
  const minOffset = Math.max(0, buffer.length - 65557); // max comment length + EOCD size
  for (let i = buffer.length - 22; i >= minOffset; i--) {
    if (buffer.readUInt32LE(i) === signature) return i;
  }
  return -1;
}

module.exports = { readZipEntries };
