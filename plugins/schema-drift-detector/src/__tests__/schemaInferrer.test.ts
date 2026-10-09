import { describe, it, expect } from 'vitest';
import {
  inferJsonSchema,
  inferXmlSchema,
  inferPayloadSchema,
  detectStringFormat,
  mergeSchemas,
  parseXmlToObject,
} from '../utils/schemaInferrer';

describe('schemaInferrer', () => {
  describe('detectStringFormat', () => {
    it('detects UUID format', () => {
      expect(detectStringFormat('123e4567-e89b-12d3-a456-426614174000')).toBe('uuid');
    });

    it('detects ISO date-time format', () => {
      expect(detectStringFormat('2026-10-06T05:30:00.000Z')).toBe('date-time');
      expect(detectStringFormat('2026-10-06')).toBe('date-time');
    });

    it('detects email format', () => {
      expect(detectStringFormat('developer@voiden.md')).toBe('email');
    });

    it('detects URL format', () => {
      expect(detectStringFormat('https://api.voiden.md/v1/users')).toBe('url');
    });

    it('returns undefined for plain strings', () => {
      expect(detectStringFormat('hello world')).toBeUndefined();
    });
  });

  describe('inferJsonSchema', () => {
    it('infers primitives correctly', () => {
      expect(inferJsonSchema(42)).toEqual({ type: 'integer', format: 'int32', example: 42 });
      expect(inferJsonSchema(3.1415)).toEqual({ type: 'number', format: 'float', example: 3.1415 });
      expect(inferJsonSchema(true)).toEqual({ type: 'boolean', example: true });
      expect(inferJsonSchema('John Doe')).toEqual({ type: 'string', format: undefined, example: 'John Doe' });
      expect(inferJsonSchema(null)).toEqual({ type: 'null', nullable: true });
    });

    it('infers nested objects', () => {
      const payload = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Voiden',
        count: 10,
        active: true,
        meta: {
          version: '1.0.0',
        },
      };

      const schema = inferJsonSchema(payload);
      expect(schema.type).toBe('object');
      expect(schema.properties?.id.type).toBe('string');
      expect(schema.properties?.id.format).toBe('uuid');
      expect(schema.properties?.count.type).toBe('integer');
      expect(schema.properties?.active.type).toBe('boolean');
      expect(schema.properties?.meta.type).toBe('object');
      expect(schema.properties?.meta.properties?.version.type).toBe('string');
      expect(schema.required).toContain('id');
      expect(schema.required).toContain('name');
    });

    it('infers homogeneous and heterogeneous arrays', () => {
      const numbers = [1, 2, 3];
      const numSchema = inferJsonSchema(numbers);
      expect(numSchema.type).toBe('array');
      expect(numSchema.items?.type).toBe('integer');

      const objects = [
        { id: 1, name: 'A' },
        { id: 2, name: 'B', role: 'admin' },
      ];
      const objSchema = inferJsonSchema(objects);
      expect(objSchema.type).toBe('array');
      expect(objSchema.items?.type).toBe('object');
      expect(objSchema.items?.properties?.id.type).toBe('integer');
      expect(objSchema.items?.properties?.name.type).toBe('string');
      expect(objSchema.items?.properties?.role.type).toBe('string');
      expect(objSchema.items?.required).toContain('id');
      expect(objSchema.items?.required).toContain('name');
      expect(objSchema.items?.required).not.toContain('role');
    });
  });

  describe('inferXmlSchema', () => {
    it('parses XML payload into object and schema', () => {
      const xml = `
        <response status="success">
          <user id="101">
            <name>Alice</name>
            <email>alice@example.com</email>
            <score>98.5</score>
            <verified>true</verified>
          </user>
        </response>
      `;

      const schema = inferXmlSchema(xml);
      expect(schema.type).toBe('object');
      expect(schema.properties?.response).toBeDefined();
      const respObj = schema.properties?.response;
      expect(respObj.properties?.user.properties?.name.type).toBe('string');
      expect(respObj.properties?.user.properties?.email.format).toBe('email');
      expect(respObj.properties?.user.properties?.score.type).toBe('number');
      expect(respObj.properties?.user.properties?.verified.type).toBe('boolean');
      expect(respObj.properties?.['@status'].type).toBe('string');
    });
  });

  describe('inferPayloadSchema', () => {
    it('handles JSON strings automatically', () => {
      const jsonStr = JSON.stringify({ ok: true, data: [1, 2] });
      const { schema, format } = inferPayloadSchema(jsonStr);
      expect(format).toBe('json');
      expect(schema.type).toBe('object');
      expect(schema.properties?.ok.type).toBe('boolean');
    });

    it('handles XML strings automatically', () => {
      const xmlStr = '<item><id>123</id></item>';
      const { schema, format } = inferPayloadSchema(xmlStr);
      expect(format).toBe('xml');
      expect(schema.type).toBe('object');
    });
  });
});
