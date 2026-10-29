import { describe, expect, it } from "vitest";
import { prettifyJSONC } from "../jsonc";

describe("prettifyJSONC", () => {
  it("keeps unquoted template expressions intact", () => {
    expect(prettifyJSONC('{"name": {{user}}, "token":{{process.token}}}')).toBe(
      '{\n  "name": {{user}},\n  "token": {{process.token}}\n}',
    );
  });

  it("keeps template expressions inside strings and comments intact", () => {
    expect(prettifyJSONC('{"name": "{{ $faker.person.firstName }}", // {{note}}\n"id": 1}')).toBe(
      '{\n  "name": "{{ $faker.person.firstName }}", // {{note}}\n  "id": 1\n}',
    );
  });

  it("keeps the text of a body that already uses the placeholder prefix", () => {
    expect(prettifyJSONC('{"__voiden_template_0__": {{a}}}')).toBe(
      '{\n  "__voiden_template_0__": {{a}}\n}',
    );
  });

  it("still formats plain JSON", () => {
    expect(prettifyJSONC('{"a":[1,2],"b":{"c":null}}')).toBe(
      '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {\n    "c": null\n  }\n}',
    );
  });
});
