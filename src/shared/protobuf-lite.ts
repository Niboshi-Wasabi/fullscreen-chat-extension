/**
 * Minimal protobuf wire reader (no codegen dependency).
 * 最小の protobuf ワイヤリーダ（codegen 依存なし）。
 */

export interface ProtoField {
  number: number;
  wireType: number;
  bytes?: Uint8Array;
  varint?: number;
}

/** Split a length-delimited protobuf stream into message payloads.
 * length-delimited ストリームをメッセージ本体へ分割する。 */
export function splitLengthDelimited(bytes: Uint8Array): Uint8Array[] {
  const messages: Uint8Array[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const size = readVarint(bytes, offset);
    if (!size || size.value <= 0) {
      break;
    }
    offset = size.next;
    const end = offset + size.value;
    if (end > bytes.length) {
      break;
    }
    messages.push(bytes.subarray(offset, end));
    offset = end;
  }
  return messages;
}

export function readFields(bytes: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset);
    if (!key) {
      break;
    }
    offset = key.next;
    const fieldNumber = key.value >>> 3;
    const wireType = key.value & 7;
    if (wireType === 0) {
      const value = readVarint(bytes, offset);
      if (!value) {
        break;
      }
      offset = value.next;
      fields.push({ number: fieldNumber, wireType, varint: value.value });
      continue;
    }
    if (wireType === 1) {
      offset += 8;
      continue;
    }
    if (wireType === 5) {
      offset += 4;
      continue;
    }
    if (wireType === 2) {
      const size = readVarint(bytes, offset);
      if (!size) {
        break;
      }
      offset = size.next;
      const end = offset + size.value;
      if (end > bytes.length) {
        break;
      }
      fields.push({
        number: fieldNumber,
        wireType,
        bytes: bytes.subarray(offset, end),
      });
      offset = end;
      continue;
    }
    break;
  }
  return fields;
}

export function fieldBytes(
  fields: ProtoField[],
  number: number,
): Uint8Array | null {
  return (
    fields.find((field) => field.number === number && field.bytes)?.bytes ??
    null
  );
}

export function fieldVarint(
  fields: ProtoField[],
  number: number,
): number | undefined {
  return fields.find(
    (field) => field.number === number && field.varint !== undefined,
  )?.varint;
}

export function fieldString(
  fields: ProtoField[],
  number: number,
): string | null {
  const bytes = fieldBytes(fields, number);
  if (!bytes) {
    return null;
  }
  try {
    const text = new TextDecoder().decode(bytes);
    return text.includes("\uFFFD") ? null : text;
  } catch {
    return null;
  }
}

export function readVarint(
  bytes: Uint8Array,
  offset: number,
): { value: number; next: number } | null {
  let result = 0;
  let shift = 0;
  let index = offset;
  while (index < bytes.length && shift <= 35) {
    const byte = bytes[index]!;
    index += 1;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: result >>> 0, next: index };
    }
    shift += 7;
  }
  return null;
}
