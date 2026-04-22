import {
  Document,
  RulesetDefinition,
  Spectral,
} from "@stoplight/spectral-core";
import { Diagnostic } from "@codemirror/lint";
import { oas } from "@stoplight/spectral-rulesets";
import {
  getLocationForJsonPath as _getLocationForJsonPath,
  parseWithPointers,
  trapAccess,
} from "@stoplight/yaml";
import type { YamlParserResult as _YamlParserResult } from "@stoplight/yaml";
import type { ILocation, JsonPath } from "@stoplight/types";
import { EditorView } from "@codemirror/view";
import { Resolver } from "@stoplight/json-ref-resolver";
import { z } from "zod";

type YamlParserResult<T> = Omit<_YamlParserResult<T>, "comments">;

function getLocationForJsonPath<T>(
  result: YamlParserResult<T>,
  path: JsonPath,
): ILocation | undefined {
  return _getLocationForJsonPath(result as _YamlParserResult<T>, path);
}

const parseYaml = (input: string): YamlParserResult<unknown> =>
  parseWithPointers(input, {
    ignoreDuplicateKeys: false,
    mergeKeys: true,
    preserveKeyOrder: true,
    attachComments: false,
  });

const Yaml = {
  parse: parseYaml,
  getLocationForJsonPath,
  trapAccess,
};

// this library cannot parse hash fragments in the URI...
const customResolver = (refLinks: string[]) =>
  new Resolver({
    resolvers: {
      file: {
        async resolve(ref: URI) {
          const refString = ref.toString();

          // Check if the ref is an internal reference
          if (refString.startsWith("#")) {
            return { resolved: true }; // Internal references are always resolved
          }

          // Handle external references
          // Normalize refLinks and refString for comparison
          const normalizedRefLinks = refLinks.map((link) =>
            decodeURIComponent(link.trim()),
          );
          const normalizedRefString = decodeURIComponent(refString.trim());

          if (normalizedRefLinks.includes(normalizedRefString)) {
            return { resolved: true }; // Indicate that the link is resolved
          } else {
            throw new Error(`Unresolved reference: ${ref}`);
          }
        },
      },
    },
  });

export async function lintYaml(
  view: EditorView,
  refLinks: string[],
): Promise<Diagnostic[]> {
  if (view.state.doc.length === 0) return [];
  const diagnostics: Diagnostic[] = [];

  try {
    const doc = new Document(view.state.doc.toString(), Yaml);
    const spectral = new Spectral({ resolver: customResolver(refLinks) });
    const customRules = {
      ...(oas as RulesetDefinition),
      rules: {
        ...oas.rules,
      },
    } as RulesetDefinition & { rules: Record<string, unknown> };

    delete customRules.rules["info-description"];
    delete customRules.rules["info-contact"];
    delete customRules.rules["operation-description"];
    delete customRules.rules["operation-operationId"];
    delete customRules.rules["operation-tags"];

    // a0e8118c-23c9-46b2-baba-3a421a214861/#components/JSONSchema"
    // a0e8118c23c946b2baba3a421a214861/#components/JSONSchema"

    spectral.setRuleset(customRules);
    await spectral
      .run(doc, {
        ignoreUnknownFormat: true,
      })
      .then((results) => {
        results.map((result) => {
          const fromLine = view.state.doc.line(result.range.start.line + 1);
          const from = fromLine.from + result.range.start.character;

          const toLine = view.state.doc.line(result.range.end.line + 1);
          const to = toLine.from + result.range.end.character;

          diagnostics.push({
            from: from,
            to: to,
            message: result.message,
            severity: "error",
            renderMessage: () => {
              const box = document.createElement('div');
              box.style.cssText = 'color:var(--fg-primary)';
              box.textContent = result.message;
              return box;
            },
          });
        });
      });
  } catch (error) {
    const errorSchema = z.object({
      mark: z
        .object({
          line: z.number(),
          column: z.number(),
        })
        .optional(),
      message: z.string(),
    });

    const parsedError = errorSchema.safeParse(error);

    if (parsedError.success && parsedError.data.mark) {
      const line = view.state.doc.line(parsedError.data.mark.line + 1);
      const from = line.from + parsedError.data.mark.column;

      diagnostics.push({
        from: from,
        to: view.state.doc.length,
        message: `Syntax error: ${parsedError.data.message}`,
        severity: "error",
      });
    } else {
      diagnostics.push({
        from: 0,
        to: view.state.doc.length,
        message: "An error occurred while parsing the document",
        severity: "error",
      });
    }
  }
  return diagnostics;
}
