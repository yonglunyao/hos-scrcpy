import {
  encodeVarint, encodeTag, encodeLengthDelimited, encodeInt32,
  encodeBool, encodeFloat,
} from '../../src/capture/protobuf';

// Re-usable encoded fragments for building test messages

export const FIXTURES = {
  // A simple ReplyMessage with just data="hello" (field 1, string)
  helloMessage: (): Buffer => {
    const data = Buffer.from('hello', 'utf-8');
    return Buffer.concat([
      encodeTag(1, 2), // field 1, length-delimited
      encodeVarint(data.length),
      data,
    ]);
  },

  // ReplyMessage with data + reply_type=1
  dataAndType: (): Buffer => Buffer.concat([
    FIXTURES.helloMessage(),
    encodeTag(2, 0), // field 2, varint
    encodeVarint(1),
  ]),

  // A ParamValue with val_int=42 (field 1, varint)
  paramInt42: (): Buffer => encodeInt32(1, 42),

  // A ParamValue with val_string="test" (field 3, string)
  paramString: (): Buffer => encodeLengthDelimited(3, Buffer.from('test', 'utf-8')),

  // A ParamValue with val_bool=true (field 4, bool)
  paramBoolTrue: (): Buffer => encodeBool(4, true),

  // A ParamValue with val_float=3.14 (field 6, float)
  paramFloat: (): Buffer => encodeFloat(6, 3.14),

  // gRPC frame wrapping empty payload
  grpcEmptyFrame: (): Buffer => {
    const frame = Buffer.alloc(5);
    frame[0] = 0;
    frame.writeUInt32BE(0, 1);
    return frame;
  },

  // gRPC frame wrapping a hello message
  grpcHelloFrame: (): Buffer => {
    const payload = FIXTURES.helloMessage();
    const frame = Buffer.alloc(5 + payload.length);
    frame[0] = 0;
    frame.writeUInt32BE(payload.length, 1);
    payload.copy(frame, 5);
    return frame;
  },
};
