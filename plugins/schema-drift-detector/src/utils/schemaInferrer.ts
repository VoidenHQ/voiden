import type { SchemaNode, SchemaType } from '../types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_REGEX = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

/**
 * Detect string format (uuid, date-time, email, url, etc.)
 */
export function detectStringFormat(val: string): string | undefined {
  if (!val || val.length > 500) return undefined;
  if (UUID_REGEX.test(val)) return 'uuid';
  if (ISO_DATE_REGEX.test(val)) return 'date-time';
  if (EMAIL_REGEX.test(val)) return 'email';
  if (URL_REGEX.test(val)) return 'url';
  return undefined;
}

/**
 * Infer schema node from any JSON value
 */
export function inferJsonSchema(value: any, maxDepth = 20, currentDepth = 0): SchemaNode {
  if (currentDepth > maxDepth) {
    return { type: 'unknown' };
  }

  if (value === null || value === undefined) {
    return { type: 'null', nullable: true };
  }

  if (typeof value === 'boolean') {
    return { type: 'boolean', example: value };
  }

  if (typeof value === 'number') {
    const isInteger = Number.isInteger(value);
    return {
      type: isInteger ? 'integer' : 'number',
      format: isInteger ? 'int32' : 'float',
      example: value,
    };
  }

  if (typeof value === 'string') {
    const format = detectStringFormat(value);
    return {
      type: 'string',
      format,
      example: value.length > 100 ? `${value.slice(0, 97)}...` : value,
    };
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return {
        type: 'array',
        items: { type: 'unknown' },
        elementCount: 0,
      };
    }

    // Merge schemas of array items
    const itemSchemas = value.map((item) => inferJsonSchema(item, maxDepth, currentDepth + 1));
    const mergedItemSchema = mergeSchemas(itemSchemas);

    return {
      type: 'array',
      items: mergedItemSchema,
      elementCount: value.length,
    };
  }

  if (typeof value === 'object') {
    const properties: Record<string, SchemaNode> = {};
    const required: string[] = [];

    for (const key of Object.keys(value)) {
      const propVal = value[key];
      properties[key] = inferJsonSchema(propVal, maxDepth, currentDepth + 1);
      if (propVal !== null && propVal !== undefined) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required,
    };
  }

  return { type: 'unknown' };
}

/**
 * Merge multiple schema nodes (e.g. for array items)
 */
export function mergeSchemas(schemas: SchemaNode[]): SchemaNode {
  if (schemas.length === 0) return { type: 'unknown' };
  if (schemas.length === 1) return schemas[0];

  const types = new Set<SchemaType>();
  let nullable = false;
  const objectProps: Record<string, SchemaNode[]> = {};
  const arrayItems: SchemaNode[] = [];
  let format: string | undefined = undefined;

  for (const s of schemas) {
    if (Array.isArray(s.type)) {
      s.type.forEach((t) => types.add(t));
    } else {
      types.add(s.type);
    }

    if (s.nullable || s.type === 'null') {
      nullable = true;
    }

    if (s.format) {
      format = s.format;
    }

    if (s.properties) {
      for (const [k, v] of Object.entries(s.properties)) {
        if (!objectProps[k]) objectProps[k] = [];
        objectProps[k].push(v);
      }
    }

    if (s.items) {
      arrayItems.push(s.items);
    }
  }

  const typeArr = Array.from(types).filter((t) => t !== 'null');
  const finalType: SchemaType | SchemaType[] =
    typeArr.length === 0 ? 'null' : typeArr.length === 1 ? typeArr[0] : typeArr;

  const result: SchemaNode = {
    type: finalType,
    nullable: nullable || types.has('null'),
  };

  if (format) result.format = format;

  if (types.has('object') && Object.keys(objectProps).length > 0) {
    result.properties = {};
    result.required = [];

    for (const [k, pSchemas] of Object.entries(objectProps)) {
      result.properties[k] = mergeSchemas(pSchemas);
      // If property is present in all object instances, mark as required
      if (pSchemas.length === schemas.length) {
        result.required.push(k);
      }
    }
  }

  if (types.has('array') && arrayItems.length > 0) {
    result.items = mergeSchemas(arrayItems);
  }

  return result;
}

/**
 * Lightweight XML to object parser for schema inference
 */
export function parseXmlToObject(xmlStr: string): any {
  const cleaned = xmlStr.trim();
  if (!cleaned.startsWith('<')) {
    throw new Error('Not valid XML content');
  }

  // Remove XML declaration and comments
  const stripped = cleaned
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();

  let index = 0;

  function skipWhitespace() {
    while (index < stripped.length && /\s/.test(stripped[index])) {
      index++;
    }
  }

  function parseAttributes(attrString: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const regex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match;
    while ((match = regex.exec(attrString)) !== null) {
      attrs[`@${match[1]}`] = match[2] !== undefined ? match[2] : match[3];
    }
    return attrs;
  }

  function parseNode(): any {
    skipWhitespace();
    if (index >= stripped.length) return null;

    if (stripped[index] !== '<') {
      // Text node
      const nextTag = stripped.indexOf('<', index);
      const text = (nextTag === -1 ? stripped.slice(index) : stripped.slice(index, nextTag)).trim();
      index = nextTag === -1 ? stripped.length : nextTag;
      return text;
    }

    if (stripped.startsWith('</', index)) {
      return null;
    }

    // Opening tag
    const endTagIndex = stripped.indexOf('>', index);
    if (endTagIndex === -1) return null;

    const tagContent = stripped.slice(index + 1, endTagIndex).trim();
    const isSelfClosing = tagContent.endsWith('/');
    const cleanTagContent = isSelfClosing ? tagContent.slice(0, -1).trim() : tagContent;

    const firstSpace = cleanTagContent.search(/\s/);
    const tagName = firstSpace === -1 ? cleanTagContent : cleanTagContent.slice(0, firstSpace);
    const attrString = firstSpace === -1 ? '' : cleanTagContent.slice(firstSpace);

    index = endTagIndex + 1;
    const attributes = parseAttributes(attrString);

    if (isSelfClosing) {
      return { [tagName]: Object.keys(attributes).length > 0 ? attributes : null };
    }

    const children: Record<string, any> = { ...attributes };
    let textContent = '';

    while (index < stripped.length) {
      skipWhitespace();
      if (stripped.startsWith(`</${tagName}>`, index)) {
        index += tagName.length + 3;
        break;
      }
      if (stripped.startsWith('</', index)) {
        // Closing unexpected tag
        const nextGt = stripped.indexOf('>', index);
        index = nextGt === -1 ? stripped.length : nextGt + 1;
        break;
      }

      if (stripped[index] === '<') {
        const child = parseNode();
        if (child && typeof child === 'object') {
          for (const [childKey, childVal] of Object.entries(child)) {
            if (children[childKey] !== undefined) {
              if (!Array.isArray(children[childKey])) {
                children[childKey] = [children[childKey]];
              }
              children[childKey].push(childVal);
            } else {
              children[childKey] = childVal;
            }
          }
        }
      } else {
        const nextTag = stripped.indexOf('<', index);
        const text = (nextTag === -1 ? stripped.slice(index) : stripped.slice(index, nextTag)).trim();
        if (text) textContent += (textContent ? ' ' : '') + text;
        index = nextTag === -1 ? stripped.length : nextTag;
      }
    }

    const hasChildren = Object.keys(children).length > 0;
    let nodeValue: any;

    if (!hasChildren) {
      nodeValue = textContent ? autoCastXmlValue(textContent) : null;
    } else {
      if (textContent) {
        children['#text'] = autoCastXmlValue(textContent);
      }
      nodeValue = children;
    }

    return { [tagName]: nodeValue };
  }

  const result = parseNode();
  return result || {};
}

function autoCastXmlValue(val: string): any {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null') return null;
  if (/^-?\d+$/.test(val)) return parseInt(val, 10);
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
  return val;
}

/**
 * Infer schema node from XML string
 */
export function inferXmlSchema(xmlString: string): SchemaNode {
  try {
    const parsed = parseXmlToObject(xmlString);
    const schema = inferJsonSchema(parsed);
    return schema;
  } catch (err) {
    return {
      type: 'string',
      example: 'Invalid XML or plain text',
    };
  }
}

/**
 * Main inference function for any API response body
 */
export function inferPayloadSchema(
  body: any,
  contentType?: string | null
): { schema: SchemaNode; format: 'json' | 'xml' | 'unknown' } {
  if (body === null || body === undefined) {
    return { schema: { type: 'null', nullable: true }, format: 'json' };
  }

  // Already parsed JSON object or array
  if (typeof body === 'object') {
    return { schema: inferJsonSchema(body), format: 'json' };
  }

  if (typeof body === 'string') {
    const trimmed = body.trim();

    // Check if JSON string
    if (
      contentType?.includes('json') ||
      ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']')))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        return { schema: inferJsonSchema(parsed), format: 'json' };
      } catch {
        // Fall through
      }
    }

    // Check if XML string
    if (contentType?.includes('xml') || (trimmed.startsWith('<') && trimmed.endsWith('>'))) {
      try {
        const schema = inferXmlSchema(trimmed);
        return { schema, format: 'xml' };
      } catch {
        // Fall through
      }
    }

    // Primitive string
    return {
      schema: {
        type: 'string',
        format: detectStringFormat(trimmed),
        example: trimmed.slice(0, 100),
      },
      format: 'unknown',
    };
  }

  return {
    schema: inferJsonSchema(body),
    format: 'json',
  };
}
