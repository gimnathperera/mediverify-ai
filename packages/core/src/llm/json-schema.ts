import { z } from 'zod';

type Json = Record<string, unknown>;

/**
 * Convert a zod schema to the JSON Schema subset accepted by OpenAI strict structured outputs:
 * every object property required, additionalProperties false, no $schema / unsupported keywords.
 * Optional fields must therefore be modelled as `.nullable()` in our schemas.
 */
export function toStrictJsonSchema(schema: z.ZodType): Json {
  const raw = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'throw' }) as Json;
  return strictify(raw) as Json;
}

const DROP_KEYS = new Set([
  '$schema',
  'format',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minItems',
  'maxItems',
  'default',
]);

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (!node || typeof node !== 'object') return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node as Json)) {
    if (DROP_KEYS.has(k)) continue;
    out[k] = strictify(v);
  }
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  return out;
}
