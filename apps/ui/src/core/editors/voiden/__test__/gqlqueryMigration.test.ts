import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { parseMarkdown } from "@/core/editors/voiden/markdownConverter";

/**
 * Regression test for: opening/saving a `.void` file with an old-format
 * `gqlquery` block (query text stored directly on `attrs.body`, no
 * `gqlurl`/`gqlbody` children — the pre-migration shape) silently dropped
 * `uid` (and `pluginId`/`pluginVersion`) when migrating it to the current
 * gqlurl+gqlbody shape, because the migration rebuilt `attrs` from scratch
 * with only `importedFrom` carried over.
 *
 * That orphaned the block's identity: anything that looks a request up by
 * `uid` afterward — voiden-runner's `list_requests`/`write_result` MCP
 * tools, or a `linkedBlock` targeting it — could no longer find it, which
 * surfaces as generic "not found" failures with nothing pointing at the
 * real cause.
 */
describe("gqlquery old-format migration", () => {
  // Minimal schema: just enough node types for parseMarkdown to recognize
  // `gqlquery` as a known type (schema.nodes[type] must exist — see
  // markdownConverter.ts's missingPluginBlock fallback) and reach the
  // migration branch instead of diverting to it.
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      text: { group: "inline" },
      paragraph: { content: "inline*", group: "block" },
      gqlquery: { group: "block", content: "(gqlurl gqlbody)?", attrs: { uid: { default: null }, importedFrom: { default: null }, pluginId: { default: null }, pluginVersion: { default: null }, body: { default: null }, operationType: { default: null }, endpoint: { default: null }, schemaFileName: { default: null }, schemaFilePath: { default: null }, schemaUrl: { default: null } } },
      gqlurl: { group: "block", content: "text*" },
      gqlbody: { group: "block", attrs: { body: { default: null }, operationType: { default: null }, schemaFileName: { default: null }, schemaFilePath: { default: null }, schemaUrl: { default: null }, importedFrom: { default: null } } },
    },
  });

  it("preserves uid/pluginId/pluginVersion when migrating an old-format block", () => {
    const markdown =
      "```void\n" +
      "---\n" +
      "type: gqlquery\n" +
      "attrs:\n" +
      "  uid: 825cb614-99af-4d19-ac1e-7af0dcb2acf5\n" +
      "  pluginId: voiden-graphql\n" +
      "  pluginVersion: 1.0.6\n" +
      "  endpoint: https://api.example.com/graphql\n" +
      "  body: 'query { me { id } }'\n" +
      "  operationType: query\n" +
      "---\n" +
      "```\n";

    const doc = parseMarkdown(markdown, schema);
    const gqlquery = doc.content.find((n: any) => n.type === "gqlquery");

    expect(gqlquery?.attrs?.uid).toBe("825cb614-99af-4d19-ac1e-7af0dcb2acf5");
    expect(gqlquery?.attrs?.pluginId).toBe("voiden-graphql");
    expect(gqlquery?.attrs?.pluginVersion).toBe("1.0.6");
    // Migration should still have moved the query text and endpoint onto the new children.
    const gqlbody = gqlquery?.content?.find((n: any) => n.type === "gqlbody");
    expect(gqlbody?.attrs?.body).toBe("query { me { id } }");
  });
});
