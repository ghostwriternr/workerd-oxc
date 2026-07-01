export interface DecodedSourceMap {
  version: number;
  mappings: string;
  sources: string[];
  names?: string[];
  sourcesContent?: string[];
}

export interface GeneratedPosition {
  line: number;
  column: number;
}

export interface OriginalPosition {
  source: string;
  line: number;
  column: number;
}

const BASE64_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Map([...BASE64_DIGITS].map((char, index) => [char, index]));
const VLQ_CONTINUATION_BIT = 32;
const VLQ_VALUE_MASK = 31;

export function originalPositionFor(map: DecodedSourceMap, generated: GeneratedPosition): OriginalPosition | undefined {
  if (map.version !== 3 || typeof map.mappings !== "string") return undefined;
  const targetLineIndex = Math.max(0, Math.trunc(generated.line) - 1);
  const targetColumn = Math.max(0, Math.trunc(generated.column) - 1);
  const lines = map.mappings.split(";");
  if (targetLineIndex >= lines.length) return undefined;

  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;

  for (let lineIndex = 0; lineIndex <= targetLineIndex; lineIndex++) {
    let generatedColumn = 0;
    let best: OriginalPosition | undefined;
    let nearestSegmentIsMapped = false;
    const segments = lines[lineIndex]?.split(",").filter(Boolean) ?? [];

    for (const segment of segments) {
      const decoded = decodeVlqSegment(segment);
      if (decoded.length === 0) continue;

      generatedColumn += decoded[0] ?? 0;
      if (lineIndex === targetLineIndex && generatedColumn > targetColumn) break;

      if (decoded.length >= 4) {
        sourceIndex += decoded[1] ?? 0;
        originalLine += decoded[2] ?? 0;
        originalColumn += decoded[3] ?? 0;
        if (decoded.length >= 5) nameIndex += decoded[4] ?? 0;

        if (lineIndex === targetLineIndex) {
          const source = map.sources[sourceIndex];
          best = source === undefined
            ? undefined
            : {
                source,
                line: originalLine + 1,
                column: originalColumn + 1
              };
          nearestSegmentIsMapped = source !== undefined;
        }
      } else if (lineIndex === targetLineIndex) {
        best = undefined;
        nearestSegmentIsMapped = false;
      }
    }

    if (lineIndex === targetLineIndex) return nearestSegmentIsMapped ? best : undefined;
  }

  return undefined;
}

function decodeVlqSegment(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;

  for (const char of segment) {
    const digit = BASE64_VALUES.get(char);
    if (digit === undefined) return [];

    value += (digit & VLQ_VALUE_MASK) << shift;

    if ((digit & VLQ_CONTINUATION_BIT) === 0) {
      values.push(fromVlqSigned(value));
      value = 0;
      shift = 0;
    } else {
      shift += 5;
    }
  }

  return values;
}

function fromVlqSigned(value: number): number {
  const negative = (value & 1) === 1;
  const shifted = value >> 1;
  return negative ? -shifted : shifted;
}
