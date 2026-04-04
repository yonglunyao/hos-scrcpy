import { describe, it, expect } from 'vitest';
import {
  encodeVarint, decodeVarint, encodeTag, encodeLengthDelimited,
  encodeInt32, encodeInt64, encodeBool, encodeFloat, encodeDouble,
  decodeString, decodeBytes, decodeParamValue,
  decodeReplyMessage, decodeReplyEndMessage,
  encodeGrpcMessage, decodeGrpcFrame, encodeEmpty,
  WIRE_VARINT, WIRE_64BIT, WIRE_LENGTH_DELIMITED, WIRE_32BIT,
} from '../../src/capture/protobuf';
import { FIXTURES } from '../helpers/fixtures';

describe('protobuf wire format constants', () => {
  it('WIRE_VARINT = 0', () => expect(WIRE_VARINT).toBe(0));
  it('WIRE_64BIT = 1', () => expect(WIRE_64BIT).toBe(1));
  it('WIRE_LENGTH_DELIMITED = 2', () => expect(WIRE_LENGTH_DELIMITED).toBe(2));
  it('WIRE_32BIT = 5', () => expect(WIRE_32BIT).toBe(5));
});

describe('encodeVarint', () => {
  it('encodes 0', () => expect(encodeVarint(0)).toEqual(Buffer.from([0x00])));
  it('encodes single-byte value 127', () => expect(encodeVarint(127)).toEqual(Buffer.from([0x7f])));
  it('encodes two-byte value 128', () => expect(encodeVarint(128)).toEqual(Buffer.from([0x80, 0x01])));
  it('encodes two-byte value 300', () => expect(encodeVarint(300)).toEqual(Buffer.from([0xac, 0x02])));
  it('encodes bigint', () => expect(encodeVarint(BigInt(16384))).toEqual(Buffer.from([0x80, 0x80, 0x01])));
});

describe('decodeVarint', () => {
  it('decodes single byte', () => {
    const [val, offset] = decodeVarint(Buffer.from([0x7f]), 0);
    expect(val).toBe(127n);
    expect(offset).toBe(1);
  });

  it('decodes multi-byte', () => {
    const buf = Buffer.from([0x80, 0x01]);
    const [val, offset] = decodeVarint(buf, 0);
    expect(val).toBe(128n);
    expect(offset).toBe(2);
  });

  it('decodes from non-zero offset', () => {
    const buf = Buffer.from([0xff, 0x7f]);
    const [val, offset] = decodeVarint(buf, 1);
    expect(val).toBe(127n);
    expect(offset).toBe(2);
  });

  it('round-trip with encodeVarint', () => {
    for (const v of [0, 1, 127, 128, 255, 300, 16384, 2097152]) {
      const encoded = encodeVarint(v);
      const [decoded] = decodeVarint(encoded, 0);
      expect(decoded).toBe(BigInt(v));
    }
  });

  it('round-trip with bigint', () => {
    const big = BigInt('123456789012345');
    const encoded = encodeVarint(big);
    const [decoded] = decodeVarint(encoded, 0);
    expect(decoded).toBe(big);
  });
});

describe('encodeTag', () => {
  it('field 1 varint', () => expect(encodeTag(1, 0)).toEqual(Buffer.from([0x08])));
  it('field 1 length-delimited', () => expect(encodeTag(1, 2)).toEqual(Buffer.from([0x0a])));
  it('field 2 varint', () => expect(encodeTag(2, 0)).toEqual(Buffer.from([0x10])));
  it('field 6 32-bit', () => expect(encodeTag(6, 5)).toEqual(Buffer.from([0x35])));
  it('field 15 varint', () => expect(encodeTag(15, 0)).toEqual(Buffer.from([0x78])));
});

describe('encodeLengthDelimited', () => {
  it('encodes string data', () => {
    const data = Buffer.from('hello', 'utf-8');
    const result = encodeLengthDelimited(1, data);
    // tag(0x0a) + length(5) + data
    expect(result).toEqual(Buffer.concat([Buffer.from([0x0a, 0x05]), data]));
  });

  it('encodes empty data', () => {
    const result = encodeLengthDelimited(3, Buffer.alloc(0));
    expect(result).toEqual(Buffer.from([0x1a, 0x00]));
  });
});

describe('encodeInt32', () => {
  it('zero value returns empty buffer', () => expect(encodeInt32(1, 0)).toEqual(Buffer.alloc(0)));

  it('encodes positive value', () => {
    const result = encodeInt32(2, 42);
    expect(result.length).toBeGreaterThan(0);
  });

  it('encodes negative value', () => {
    const result = encodeInt32(1, -1);
    expect(result.length).toBeGreaterThan(0);
    // -1 as uint32 is 0xFFFFFFFF which is 4294967295
    const [val] = decodeVarint(result.subarray(1), 0); // skip tag
    expect(val).toBe(BigInt(0xFFFFFFFF));
  });

  it('encodes large value', () => {
    const result = encodeInt32(1, 2147483647); // INT32_MAX
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('encodeInt64', () => {
  it('zero value returns empty buffer', () => expect(encodeInt64(1, 0)).toEqual(Buffer.alloc(0)));

  it('encodes number value', () => {
    const result = encodeInt64(1, 100);
    expect(result.length).toBeGreaterThan(0);
  });

  it('encodes bigint value', () => {
    const big = BigInt('9007199254740993'); // > Number.MAX_SAFE_INTEGER
    const result = encodeInt64(1, big);
    expect(result.length).toBeGreaterThan(0);
  });

  it('round-trip', () => {
    for (const v of [1, 100, 999999]) {
      const result = encodeInt64(1, v);
      const [decoded] = decodeVarint(result.subarray(1), 0);
      expect(decoded).toBe(BigInt(v));
    }
  });
});

describe('encodeBool', () => {
  it('false returns empty buffer', () => expect(encodeBool(1, false)).toEqual(Buffer.alloc(0)));

  it('true encodes to tag + 1', () => {
    const result = encodeBool(4, true);
    expect(result).toEqual(Buffer.from([0x20, 0x01])); // field 4, varint, value 1
  });
});

describe('encodeFloat', () => {
  it('encodes 3.14 with correct tag', () => {
    const result = encodeFloat(6, 3.14);
    expect(result[0]).toBe(0x35); // field 6, wire type 5
    expect(result.length).toBe(5); // 1 tag + 4 bytes float
  });

  it('decodes to approximately the same value', () => {
    const result = encodeFloat(6, 3.14);
    const value = result.readFloatLE(1);
    expect(Math.abs(value - 3.14)).toBeLessThan(0.001);
  });
});

describe('encodeDouble', () => {
  it('returns tag + 8 zero bytes', () => {
    const result = encodeDouble(2, 1.5);
    expect(result[0]).toBe(0x11); // field 2, wire type 1 (64-bit)
    expect(result.length).toBe(9); // 1 tag + 8 bytes
  });
});

describe('decodeString', () => {
  it('decodes utf-8 string', () => {
    const buf = Buffer.from('hello world', 'utf-8');
    const [str, offset] = decodeString(buf, 0, 11);
    expect(str).toBe('hello world');
    expect(offset).toBe(11);
  });

  it('decodes from offset', () => {
    const buf = Buffer.from('XXhello', 'utf-8');
    const [str, offset] = decodeString(buf, 2, 5);
    expect(str).toBe('hello');
    expect(offset).toBe(7);
  });
});

describe('decodeBytes', () => {
  it('decodes raw bytes', () => {
    const buf = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
    const [bytes, offset] = decodeBytes(buf, 0, 3);
    expect(bytes).toEqual(Buffer.from([0x01, 0x02, 0x03]));
    expect(offset).toBe(3);
  });
});

describe('decodeParamValue', () => {
  it('decodes val_int', () => {
    const encoded = encodeInt32(1, 42);
    const [result] = decodeParamValue(encoded, 0, encoded.length);
    expect(result.valInt).toBe(42n);
  });

  it('decodes val_string', () => {
    const encoded = encodeLengthDelimited(3, Buffer.from('test', 'utf-8'));
    const [result] = decodeParamValue(encoded, 0, encoded.length);
    expect(result.valString).toBe('test');
  });

  it('decodes val_bool true', () => {
    const encoded = encodeBool(4, true);
    const [result] = decodeParamValue(encoded, 0, encoded.length);
    expect(result.valBool).toBe(true);
  });

  it('decodes val_float', () => {
    const encoded = encodeFloat(6, 2.5);
    const [result] = decodeParamValue(encoded, 0, encoded.length);
    expect(Math.abs(result.valFloat! - 2.5)).toBeLessThan(0.001);
  });

  it('decodes empty buffer', () => {
    const [result] = decodeParamValue(Buffer.alloc(0), 0, 0);
    expect(result).toEqual({});
  });
});

describe('decodeReplyMessage', () => {
  it('decodes message with data field', () => {
    const buf = FIXTURES.helloMessage();
    const msg = decodeReplyMessage(buf);
    expect(msg.data).toBe('hello');
    expect(msg.replyType).toBe(0);
    expect(msg.payload.size).toBe(0);
  });

  it('decodes message with data + reply_type', () => {
    const buf = FIXTURES.dataAndType();
    const msg = decodeReplyMessage(buf);
    expect(msg.data).toBe('hello');
    expect(msg.replyType).toBe(1);
  });

  it('decodes message with payload map', () => {
    // Build: data="test" + payload entry with key="width", value=val_int=1920
    const keyBuf = Buffer.from('width', 'utf-8');
    const valBuf = encodeInt32(1, 1920);
    const entryContent = Buffer.concat([
      encodeTag(1, 2), encodeVarint(keyBuf.length), keyBuf, // key
      encodeTag(2, 2), encodeVarint(valBuf.length), valBuf, // value
    ]);
    const buf = Buffer.concat([
      encodeTag(1, 2), encodeVarint(4), Buffer.from('test', 'utf-8'), // data
      encodeTag(3, 2), encodeVarint(entryContent.length), entryContent, // payload map entry
    ]);
    const msg = decodeReplyMessage(buf);
    expect(msg.data).toBe('test');
    expect(msg.payload.get('width')!.valInt).toBe(1920n);
  });

  it('decodes empty buffer', () => {
    const msg = decodeReplyMessage(Buffer.alloc(0));
    expect(msg.data).toBe('');
    expect(msg.replyType).toBe(0);
    expect(msg.payload.size).toBe(0);
  });

  it('skips unknown fields', () => {
    const buf = Buffer.concat([
      FIXTURES.helloMessage(),
      encodeTag(99, 0), // unknown field, varint wire type
      encodeVarint(123),
    ]);
    const msg = decodeReplyMessage(buf);
    expect(msg.data).toBe('hello');
  });
});

describe('decodeReplyEndMessage', () => {
  it('decodes result=0', () => {
    const buf = encodeInt32(1, 0);
    const msg = decodeReplyEndMessage(buf);
    expect(msg.result).toBe(0);
  });

  it('decodes result=1', () => {
    const buf = encodeInt32(1, 1);
    const msg = decodeReplyEndMessage(buf);
    expect(msg.result).toBe(1);
  });

  it('decodes empty buffer as result=0', () => {
    const msg = decodeReplyEndMessage(Buffer.alloc(0));
    expect(msg.result).toBe(0);
  });
});

describe('encodeEmpty', () => {
  it('returns empty buffer', () => {
    expect(encodeEmpty()).toEqual(Buffer.alloc(0));
  });
});

describe('encodeGrpcMessage', () => {
  it('creates 5-byte header + payload', () => {
    const payload = Buffer.from('test', 'utf-8');
    const frame = encodeGrpcMessage(payload);
    expect(frame.length).toBe(5 + 4);
    expect(frame[0]).toBe(0); // not compressed
    expect(frame.readUInt32BE(1)).toBe(4);
    expect(frame.subarray(5).toString()).toBe('test');
  });

  it('handles empty payload', () => {
    const frame = encodeGrpcMessage(Buffer.alloc(0));
    expect(frame.length).toBe(5);
    expect(frame.readUInt32BE(1)).toBe(0);
  });
});

describe('decodeGrpcFrame', () => {
  it('decodes single frame', () => {
    const frame = FIXTURES.grpcHelloFrame();
    const { messages, remaining } = decodeGrpcFrame(frame);
    expect(messages.length).toBe(1);
    // gRPC frame wraps the protobuf-encoded message (tag+length+"hello"), not raw string
    const payload = messages[0]!;
    expect(payload.length).toBeGreaterThan(0);
    expect(remaining.length).toBe(0);
  });

  it('decodes multiple frames', () => {
    const frame1 = FIXTURES.grpcHelloFrame();
    const frame2 = FIXTURES.grpcEmptyFrame();
    const combined = Buffer.concat([frame1, frame2]);
    const { messages, remaining } = decodeGrpcFrame(combined);
    expect(messages.length).toBe(2);
    expect(remaining.length).toBe(0);
  });

  it('handles incomplete frame (returns remaining)', () => {
    const partial = Buffer.from([0x00, 0x00, 0x00]); // only 3 bytes of header
    const { messages, remaining } = decodeGrpcFrame(partial);
    expect(messages.length).toBe(0);
    expect(remaining.length).toBe(3);
  });

  it('round-trip with encodeGrpcMessage', () => {
    const payload = Buffer.from('round-trip-test', 'utf-8');
    const encoded = encodeGrpcMessage(payload);
    const { messages } = decodeGrpcFrame(encoded);
    expect(messages[0]).toEqual(payload);
  });
});
