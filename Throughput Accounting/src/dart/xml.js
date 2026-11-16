"use strict";

/**
 * Tiny, purpose-built XML reader for DART's corpCode.xml, which is a flat,
 * non-nested structure: a sequence of <list>...</list> blocks each
 * containing a fixed set of single-value child tags. Not a general XML
 * parser - just enough to avoid pulling in an XML dependency for one file.
 */

const ENTITY_MAP = { amp: "&", lt: "<", gt: ">", apos: "'", quot: '"' };

function decodeEntities(text) {
  return text.replace(/&(amp|lt|gt|apos|quot|#\d+|#x[0-9a-fA-F]+);/g, (match, entity) => {
    if (entity in ENTITY_MAP) return ENTITY_MAP[entity];
    if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return match;
  });
}

function extractTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`));
  if (!match) return null;
  const value = match[1].trim();
  return value === "" ? null : decodeEntities(value);
}

/**
 * Parses every <list>...</list> block in the XML and returns one object per
 * block with the requested tag values.
 */
function parseListEntries(xml, tagNames) {
  const blocks = xml.match(/<list>[\s\S]*?<\/list>/g) || [];
  return blocks.map((block) => {
    const entry = {};
    for (const tag of tagNames) entry[tag] = extractTag(block, tag);
    return entry;
  });
}

module.exports = { parseListEntries, decodeEntities };
