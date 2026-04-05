/**
 * 手写 Protobuf 编解码 — 对应 scrcpy.proto
 *
 * message ReplyMessage {
 *   string data = 1;
 *   int32 reply_type = 2;
 *   map<string, ParamValue> payload = 3;
 * }
 *
 * message ParamValue {
 *   oneof values {
 *     int64   val_int    = 1;
 *     double  val_double = 2;
 *     string  val_string = 3;
 *     bool    val_bool   = 4;
 *     bytes   val_bytes  = 5;
 *     float   val_float  = 6;
 *   }
 * }
 *
 * message ReplyEndMessage { int32 result = 1; }
 * message Empty {}
 *
 * service ScrcpyService {
 *   rpc onStart(Empty) returns (stream ReplyMessage);
 *   rpc onEnd(Empty) returns (ReplyEndMessage);
 *   rpc onRequestIDRFrame(Empty) returns (ReplyEndMessage);
 * }
 */

// ========== Low-level protobuf wire format ==========

export const WIRE_VARINT = 0;
export const WIRE_64BIT = 1;
export const WIRE_LENGTH_DELIMITED = 2;
export const WIRE_32BIT = 5;

export function encodeVarint(value: number | bigint): Buffer {
  const bytes: number[] = [];
  let v = typeof value === 'bigint' ? value : BigInt(value);
  while (v > 0x7fn) {
    bytes.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

export function decodeVarint(buf: Buffer, offset: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  let i = offset;
  while (i < buf.length) {
    const b = buf[i]!;
    result |= BigInt(b & 0x7f) << shift;
    i++;
    if ((b & 0x80) === 0) break;
    shift += 7n;
  }
  return [result, i];
}

export function encodeTag(fieldNum: number, wireType: number): Buffer {
  return encodeVarint((fieldNum << 3) | wireType);
}

export function encodeLengthDelimited(fieldNum: number, data: Buffer): Buffer {
  return Buffer.concat([encodeTag(fieldNum, WIRE_LENGTH_DELIMITED), encodeVarint(data.length), data]);
}

export function encodeInt32(fieldNum: number, value: number): Buffer {
  if (value === 0) return Buffer.alloc(0);
  return Buffer.concat([encodeTag(fieldNum, WIRE_VARINT), encodeVarint(value < 0 ? value + 0x100000000 : value)]);
}

export function encodeInt64(fieldNum: number, value: number | bigint): Buffer {
  if (value === 0) return Buffer.alloc(0);
  return Buffer.concat([encodeTag(fieldNum, WIRE_VARINT), encodeVarint(BigInt(value))]);
}

export function encodeBool(fieldNum: number, value: boolean): Buffer {
  if (!value) return Buffer.alloc(0);
  return Buffer.concat([encodeTag(fieldNum, WIRE_VARINT), Buffer.from([1])]);
}

export function encodeFloat(fieldNum: number, value: number): Buffer {
  const tmp = Buffer.alloc(5);
  tmp[0] = 0x35 | (fieldNum << 3); // tag: field 6, wire type 5 (32-bit)
  tmp.writeFloatLE(value, 1);
  return tmp;
}

export function encodeDouble(fieldNum: number, _value: number): Buffer {
  return Buffer.concat([encodeTag(fieldNum, WIRE_64BIT), Buffer.alloc(8).fill(0)]);
  // Note: writeDoubleLE would go here but not needed for client-side
}

// ========== Message types ==========

export interface ParamValue {
  valInt?: bigint;
  valDouble?: number;
  valString?: string;
  valBool?: boolean;
  valBytes?: Buffer;
  valFloat?: number;
}

export interface ReplyMessage {
  data: string;
  replyType: number;
  payload: Map<string, ParamValue>;
}

export interface ReplyEndMessage {
  result: number;
}

// ========== Decoding ==========

export function decodeString(buf: Buffer, offset: number, length: number): [string, number] {
  return [buf.subarray(offset, offset + length).toString('utf-8'), offset + length];
}

export function decodeBytes(buf: Buffer, offset: number, length: number): [Buffer, number] {
  return [buf.subarray(offset, offset + length), offset + length];
}

export function decodeParamValue(buf: Buffer, offset: number, end: number): [ParamValue, number] {
  const result: ParamValue = {};
  while (offset < end) {
    const [tagVal, newOffset] = decodeVarint(buf, offset);
    offset = newOffset;
    const fieldNum = Number(tagVal >> 3n);
    const wireType = Number(tagVal & 0x7n);

    switch (fieldNum) {
      case 1: { // val_int
        const [val, o] = decodeVarint(buf, offset);
        result.valInt = val;
        offset = o;
        break;
      }
      case 2: { // val_double
        const tmp = Buffer.alloc(8);
        buf.copy(tmp, 0, offset, offset + 8);
        result.valDouble = tmp.readDoubleLE(0);
        offset += 8;
        break;
      }
      case 3: { // val_string
        const [len, o] = decodeVarint(buf, offset);
        offset = o;
        const [str, o2] = decodeString(buf, offset, Number(len));
        result.valString = str;
        offset = o2;
        break;
      }
      case 4: { // val_bool
        const [val, o] = decodeVarint(buf, offset);
        result.valBool = val !== 0n;
        offset = o;
        break;
      }
      case 5: { // val_bytes
        const [len, o] = decodeVarint(buf, offset);
        offset = o;
        const [bytes, o2] = decodeBytes(buf, offset, Number(len));
        result.valBytes = bytes;
        offset = o2;
        break;
      }
      case 6: { // val_float
        result.valFloat = buf.readFloatLE(offset);
        offset += 4;
        break;
      }
      default:
        // skip unknown field
        if (wireType === WIRE_VARINT) {
          const [, o] = decodeVarint(buf, offset);
          offset = o;
        } else if (wireType === WIRE_LENGTH_DELIMITED) {
          const [len, o] = decodeVarint(buf, offset);
          offset = o + Number(len);
        } else if (wireType === WIRE_64BIT) {
          offset += 8;
        } else if (wireType === WIRE_32BIT) {
          offset += 4;
        }
    }
  }
  return [result, offset];
}

export function decodeReplyMessage(buf: Buffer): ReplyMessage {
  let offset = 0;
  const msg: ReplyMessage = { data: '', replyType: 0, payload: new Map() };

  while (offset < buf.length) {
    const [tagVal, newOffset] = decodeVarint(buf, offset);
    offset = newOffset;
    const fieldNum = Number(tagVal >> 3n);
    const wireType = Number(tagVal & 0x7n);

    switch (fieldNum) {
      case 1: { // data (string)
        const [len, o] = decodeVarint(buf, offset);
        offset = o;
        const [str, o2] = decodeString(buf, offset, Number(len));
        msg.data = str;
        offset = o2;
        break;
      }
      case 2: { // reply_type (int32)
        const [val, o] = decodeVarint(buf, offset);
        msg.replyType = Number(val);
        offset = o;
        break;
      }
      case 3: { // payload (map<string, ParamValue>)
        // map entries are encoded as repeated messages with key=1, value=2
        const [entryLen, o] = decodeVarint(buf, offset);
        offset = o;
        const entryEnd = offset + Number(entryLen);
        let key = '';
        let value: ParamValue | undefined;

        while (offset < entryEnd) {
          const [entryTag, eo] = decodeVarint(buf, offset);
          offset = eo;
          const entryField = Number(entryTag >> 3n);
          const entryWire = Number(entryTag & 0x7n);

          if (entryField === 1) {
            // key (string)
            const [kLen, ko] = decodeVarint(buf, offset);
            offset = ko;
            const [k, ko2] = decodeString(buf, offset, Number(kLen));
            key = k;
            offset = ko2;
          } else if (entryField === 2) {
            // value (ParamValue, length-delimited)
            const [vLen, vo] = decodeVarint(buf, offset);
            offset = vo;
            const [v, vo2] = decodeParamValue(buf, offset, offset + Number(vLen));
            value = v;
            offset = vo2;
          } else {
            // skip
            if (entryWire === WIRE_VARINT) {
              const [, so] = decodeVarint(buf, offset);
              offset = so;
            } else if (entryWire === WIRE_LENGTH_DELIMITED) {
              const [sLen, so] = decodeVarint(buf, offset);
              offset = so + Number(sLen);
            }
          }
        }

        if (value) {
          msg.payload.set(key, value);
        }
        break;
      }
      default: {
        // skip unknown
        if (wireType === WIRE_VARINT) {
          const [, o] = decodeVarint(buf, offset);
          offset = o;
        } else if (wireType === WIRE_LENGTH_DELIMITED) {
          const [len, o] = decodeVarint(buf, offset);
          offset = o + Number(len);
        } else if (wireType === WIRE_64BIT) {
          offset += 8;
        } else if (wireType === WIRE_32BIT) {
          offset += 4;
        }
      }
    }
  }

  return msg;
}

export function decodeReplyEndMessage(buf: Buffer): ReplyEndMessage {
  let offset = 0;
  let result = 0;

  while (offset < buf.length) {
    const [tagVal, newOffset] = decodeVarint(buf, offset);
    offset = newOffset;
    const fieldNum = Number(tagVal >> 3n);
    const wireType = Number(tagVal & 0x7n);

    if (fieldNum === 1 && wireType === WIRE_VARINT) {
      const [val, o] = decodeVarint(buf, offset);
      result = Number(val);
      offset = o;
    } else {
      if (wireType === WIRE_VARINT) {
        const [, o] = decodeVarint(buf, offset);
        offset = o;
      } else if (wireType === WIRE_LENGTH_DELIMITED) {
        const [len, o] = decodeVarint(buf, offset);
        offset = o + Number(len);
      } else if (wireType === WIRE_64BIT) {
        offset += 8;
      } else if (wireType === WIRE_32BIT) {
        offset += 4;
      }
    }
  }

  return { result };
}

// ========== Encoding ==========

export function encodeEmpty(): Buffer {
  return Buffer.alloc(0);
}

// ========== gRPC framing ==========

// gRPC uses 5-byte frame: 1 byte compressed flag + 4 bytes big-endian length + payload

export function encodeGrpcMessage(payload: Buffer): Buffer {
  const frame = Buffer.alloc(5 + payload.length);
  frame[0] = 0; // not compressed
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

export function decodeGrpcFrame(buf: Buffer): { messages: Buffer[]; remaining: Buffer } {
  const messages: Buffer[] = [];
  let offset = 0;

  while (offset + 5 <= buf.length) {
    const _compressed = buf[offset]!;
    offset += 1;
    const length = buf.readUInt32BE(offset);
    offset += 4;

    if (offset + length > buf.length) {
      break; // incomplete frame
    }

    const payload = buf.subarray(offset, offset + length);
    offset += length;
    messages.push(payload);
  }

  return { messages, remaining: buf.subarray(offset) };
}
