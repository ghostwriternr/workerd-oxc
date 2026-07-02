export function byteOffsetToStringOffset(source: string, byteOffset: number): number {
  if (!Number.isFinite(byteOffset)) return 0;
  const target = Math.max(0, Math.trunc(byteOffset));
  let bytes = 0;

  for (let index = 0; index < source.length;) {
    if (bytes >= target) return index;
    const codePoint = source.codePointAt(index) ?? 0;
    const width = utf8ByteLength(codePoint);
    if (bytes + width > target) return index;
    bytes += width;
    index += codePoint > 0xffff ? 2 : 1;
  }

  return source.length;
}

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}
