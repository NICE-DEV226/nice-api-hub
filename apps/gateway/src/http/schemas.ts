import { Type } from '@sinclair/typebox';

export const VariantSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal('video'), Type.Literal('audio'), Type.Literal('image')]),
    url: Type.String(),
    label: Type.Optional(Type.String()),
    quality: Type.Optional(Type.String()),
    width: Type.Optional(Type.Integer()),
    height: Type.Optional(Type.Integer()),
    ext: Type.Optional(Type.String()),
    mime: Type.Optional(Type.String()),
    hasAudio: Type.Optional(Type.Boolean()),
    protocol: Type.Optional(Type.Union([Type.Literal('direct'), Type.Literal('hls')])),
    id: Type.Optional(Type.String()),
    codec: Type.Optional(Type.String()),
    fps: Type.Optional(Type.Number()),
    bitrateKbps: Type.Optional(Type.Number()),
    sizeBytes: Type.Optional(Type.Number()),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  },
  { $id: 'Variant' },
);

export const MediaSchema = Type.Object(
  {
    platform: Type.String({ examples: ['tiktok'] }),
    sourceUrl: Type.String(),
    title: Type.Union([Type.String(), Type.Null()]),
    author: Type.Union([Type.String(), Type.Null()]),
    thumbnail: Type.Union([Type.String(), Type.Null()]),
    durationSeconds: Type.Union([Type.Number(), Type.Null()]),
    variants: Type.Array(Type.Ref(VariantSchema)),
    provider: Type.String(),
    fetchedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'Media' },
);

export const ProblemSchema = Type.Object(
  {
    type: Type.String(),
    title: Type.String(),
    status: Type.Integer(),
    code: Type.String(),
    detail: Type.String(),
    requestId: Type.Optional(Type.String()),
  },
  { $id: 'Problem', additionalProperties: true },
);

export const Uuid = Type.String({ format: 'uuid' });
