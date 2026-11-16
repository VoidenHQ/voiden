import { describe, expect, it } from "vitest";
import { importProjectName } from "../ImportDialog";

describe("importProjectName", () => {
  it("names the project after the file or the API's host", () => {
    expect(importProjectName("Petstore API.postman_collection.json")).toBe("petstore-api");
    expect(importProjectName("openapi.yaml")).toBe("openapi");
    expect(importProjectName("api.example.com")).toBe("example");
    expect(importProjectName("localhost")).toBe("localhost");
    expect(importProjectName("!!!")).toBe("imported-api");
  });
});
