import type { SourceMapV3 } from "../../src/index";

export interface GeneratedPosition {
  line: number;
  column: number;
}

export interface OriginalPosition {
  source: string;
  line: number;
  column: number;
  name?: string;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Map(Array.from(BASE64, (char, index) => [char, index]));

export function originalPositionFor(map: SourceMapV3, generated: GeneratedPosition): OriginalPosition | undefined {
  const line = decodedLines(map)[generated.line - 1];
  if (!line) return undefined;

  let match: DecodedSegment | undefined;
  for (const segment of line) {
    if (segment.generatedColumn > generated.column) break;
    match = segment;
  }

  if (!match || match.sourceIndex === undefined || match.originalLine === undefined || match.originalColumn === undefined) {
    return undefined;
  }

  const source = map.sources[match.sourceIndex];
  if (source === undefined) return undefined;

  return {
    source,
    line: match.originalLine! + 1,
    column: match.originalColumn!,
    name: match.nameIndex === undefined ? undefined : map.names[match.nameIndex],
  };
}

interface DecodedSegment {
  generatedColumn: number;
  sourceIndex?: number;
  originalLine?: number;
  originalColumn?: number;
  nameIndex?: number;
}

function decodedLines(map: SourceMapV3): DecodedSegment[][] {
  let previousGeneratedColumn = 0;
  let previousSourceIndex = 0;
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;
  let previousNameIndex = 0;

  return map.mappings.split(";").map((line) => {
    previousGeneratedColumn = 0;
    if (line.length === 0) return [];

    return line.split(",").filter(Boolean).map((rawSegment) => {
      const values = decodeVlqSegment(rawSegment);
      previousGeneratedColumn += values[0] ?? 0;

      const segment: DecodedSegment = { generatedColumn: previousGeneratedColumn };
      if (values.length >= 4) {
        previousSourceIndex += values[1] ?? 0;
        previousOriginalLine += values[2] ?? 0;
        previousOriginalColumn += values[3] ?? 0;
        segment.sourceIndex = previousSourceIndex;
        segment.originalLine = previousOriginalLine;
        segment.originalColumn = previousOriginalColumn;
      }
      if (values.length >= 5) {
        previousNameIndex += values[4] ?? 0;
        segment.nameIndex = previousNameIndex;
      }
      return segment;
    });
  });
}

function decodeVlqSegment(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;

  for (const char of segment) {
    const digit = BASE64_VALUES.get(char);
    if (digit === undefined) throw new Error(`Invalid base64 VLQ digit: ${char}`);

    value += (digit & 31) << shift;
    if ((digit & 32) !== 0) {
      shift += 5;
      continue;
    }

    values.push(fromVlqSigned(value));
    value = 0;
    shift = 0;
  }

  if (shift !== 0) throw new Error(`Unterminated base64 VLQ segment: ${segment}`);
  return values;
}

function fromVlqSigned(value: number): number {
  const isNegative = (value & 1) === 1;
  const shifted = value >> 1;
  return isNegative ? -shifted : shifted;
}
