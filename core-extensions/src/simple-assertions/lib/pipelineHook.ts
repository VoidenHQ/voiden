/**
 * Post-processing hook for simple assertions
 * Executes assertions after response is received
 */

import {
  executeAssertions,
  type Assertion,
  type AssertionContext,
} from "./assertionEngine";

/**
 * Extract assertions from the request editor document
 */
function extractAssertionsFromDoc(doc: any): Assertion[] {
  const assertions: Assertion[] = [];

  if (!doc || !doc.content) {
    return assertions;
  }

  // Recursively find assertion tables in the document
  function traverse(node: any) {
    if (node.type === "assertions-table") {
      // Extract table data
      const tableData = extractTableData(node);
      assertions.push(...tableData);
    }

    if (node.content && Array.isArray(node.content)) {
      node.content.forEach((child: any) => traverse(child));
    }
  }

  traverse(doc);
  return assertions;
}

/**
 * Extract assertion data from table node
 * Supports both new format (node.attrs.rows) and old format (node.content)
 */
function extractTableData(tableNode: any): Assertion[] {
  const assertions: Assertion[] = [];

  try {
    // Check if using new format with attrs.rows
    if (tableNode.attrs && Array.isArray(tableNode.attrs.rows)) {
      const rows = tableNode.attrs.rows;

      for (const row of rows) {
        // Skip empty rows (all cells empty)
        if (!row.description && !row.field && !row.operator && !row.expectedValue) {
          continue;
        }

        // Skip disabled rows
        if (row.enabled === false) {
          continue;
        }

        assertions.push({
          description: row.description || '',
          field: row.field || '',
          operator: row.operator || 'equals',
          expectedValue: row.expectedValue || '',
          enabled: true, // Only enabled rows make it here
        });
      }

      return assertions;
    }

    // Fallback to old format with table content structure
    const table = tableNode.content?.[0]; // Get the actual table node
    if (!table || table.type !== "table") {
      return assertions;
    }

    const rows = table.content || [];

    // Process all rows (no header row anymore, just placeholders)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.type !== "tableRow") continue;

      // Check if row is disabled via attrs.disabled
      if (row.attrs && row.attrs.disabled === true) {
        continue;
      }

      const cells = row.content || [];
      if (cells.length < 4) continue; // Need at least 4 columns

      // Column 1: Description
      const descriptionCell = cells[0];
      const description = extractTextFromNode(descriptionCell).trim();

      // Column 2: Field
      const fieldCell = cells[1];
      const field = extractTextFromNode(fieldCell).trim();

      // Column 3: Operator
      const operatorCell = cells[2];
      const operator = extractTextFromNode(operatorCell).trim();

      // Column 4: Expected Value
      const valueCell = cells[3];
      const expectedValue = extractTextFromNode(valueCell).trim();

      // Skip empty rows (all cells empty)
      if (!description && !field && !operator && !expectedValue) continue;

      // Check if row is enabled (5th column checkbox if exists) - legacy support
      const enabled = cells.length >= 5 ? extractCheckboxState(cells[4]) : true;

      // Skip disabled rows (legacy checkbox method)
      if (!enabled) continue;

      assertions.push({
        description,
        field,
        operator: operator || "equals", // Default to equals if not specified
        expectedValue,
        enabled: true, // Only enabled rows make it here
      });
    }
  } catch (error) {
    console.error("Error extracting assertions from table:", error);
  }

  return assertions;
}

/**
 * Extract text content from a ProseMirror node
 */
function extractTextFromNode(node: any): string {
  if (!node) return "";

  if (node.type === "text") {
    return node.text || "";
  }

  if (node.content && Array.isArray(node.content)) {
    return node.content.map((child: any) => extractTextFromNode(child)).join("");
  }

  return "";
}

/**
 * Extract checkbox state from a table cell
 */
function extractCheckboxState(cell: any): boolean {
  // Look for checkbox node in cell content
  if (!cell || !cell.content) return true;

  const checkboxNode = cell.content.find((n: any) => n.type === "checkbox");
  if (checkboxNode && checkboxNode.attrs) {
    return checkboxNode.attrs.checked !== false;
  }

  return true; // Default to enabled
}

/**
 * Post-processing hook function
 */
export async function postProcessAssertionsHook(context: any): Promise<void> {
  const { requestState, responseState, metadata } = context;

  try {
    // Get the request editor document from requestState.metadata (stored in pre-processing with expanded blocks)
    const requestDoc = requestState?.metadata?.editorDocument ||
                       metadata?.requestDocument ||
                       metadata?.editorDocument;

    if (!requestDoc) {
      return;
    }

    // Extract assertions from the document (linked blocks already expanded in pre-processing)
    const assertions = extractAssertionsFromDoc(requestDoc);

    if (assertions.length === 0) {
      return;
    }

    // Substitute environment and runtime variables in assertion fields
    // ({{variable}} patterns in field paths, expected values, and descriptions)
    const replaceVars = (window as any).electron?.env?.replaceVariables;
    if (replaceVars) {
      for (const assertion of assertions) {
        if (assertion.expectedValue && assertion.expectedValue.includes('{{')) {
          assertion.expectedValue = await replaceVars(assertion.expectedValue);
        }
        if (assertion.field && assertion.field.includes('{{')) {
          assertion.field = await replaceVars(assertion.field);
        }
      }
    }

    // Build assertion context from response
    const assertionContext: AssertionContext = {
      response: {
        status: responseState.status,
        statusText: responseState.statusText,
        headers: responseState.headers || [],
        body: responseState.body,
        contentType: responseState.contentType,
        timing: responseState.timing,
      },
    };

    // Execute all assertions
    const results = executeAssertions(assertions, assertionContext);

    // Count passed/failed
    const passedAssertions = results.filter((r) => r.passed).length;
    const failedAssertions = results.filter((r) => !r.passed).length;

    // Store results in responseState.metadata for the response converter to pick up
    if (!responseState.metadata) {
      responseState.metadata = {};
    }

    responseState.metadata.assertionResults = {
      results,
      totalAssertions: assertions.length,
      passedAssertions,
      failedAssertions,
    };
  } catch (error) {
    console.error("[Simple Assertions] Error in post-process assertions hook:", error);
  }
}
