/**
 * GQL Body Node
 *
 * Atom node containing the GraphQL query editor, schema browser, and viewer.
 * Paired with GqlUrlNode inside a gqlquery container.
 */

import React from "react";
import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Eye, Pen, ExternalLink, FileDown, Link, Loader2, X, CircleX } from "lucide-react";
import { Buffer } from "buffer";
import {
  GraphQLField,
  GraphQLType,
  ParsedSchema,
  parseGraphQLSchema,
  loadSchemaFile as loadSchemaFileUtil,
  parseQueryFields,
  isOperationInQuery,
  generateVariablesFromQuery
} from "../utils/graphql-parser";
import { extractOperations, parseQuerySelections } from "../utils/query-parser";
import { generateQuery } from "../utils/query-generator";

export const createGqlBodyNode = (NodeViewWrapper: any, CodeEditor: any) => {
  const getDefaultTemplate = (type: string) => {
    switch (type) {
      case 'mutation':
        return 'mutation UpdateData {\n  # Write your GraphQL mutation\n}';
      case 'subscription':
        return 'subscription OnDataChange {\n  # Write your GraphQL subscription\n}';
      default:
        return 'query GetData {\n  # Write your GraphQL query\n}';
    }
  };

  const GqlBodyComponent = (props: any) => {
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [mode, setMode] = React.useState<'editor' | 'viewer'>('editor');
    const [schema, setSchema] = React.useState<ParsedSchema | null>(null);
    const [expandedOperations, setExpandedOperations] = React.useState<Set<string>>(new Set());
    const [selectedOperations, setSelectedOperations] = React.useState<Set<string>>(new Set());
    const [activeTab, setActiveTab] = React.useState<'query' | 'mutation' | 'subscription'>('query');
    const [showConnectionInput, setShowConnectionInput] = React.useState(false);
    const [connectionUrl, setConnectionUrl] = React.useState(props.node.attrs.schemaUrl || '');
    const [isConnecting, setIsConnecting] = React.useState(false);
    const [connectionError, setConnectionError] = React.useState('');

    const [editorQuery, setEditorQuery] = React.useState<string>(
      props.node.attrs.body || ''
    );
    const [operationFieldSelections, setOperationFieldSelections] = React.useState<Record<string, Set<string>>>({});
    const [fieldArgSelections, setFieldArgSelections] = React.useState<Record<string, Record<string, Set<string>>>>({});
    const [operationArgSelections, setOperationArgSelections] = React.useState<Record<string, Set<string>>>({});
    const [nestedFieldSelections, setNestedFieldSelections] = React.useState<Record<string, Record<string, Set<string>>>>({});

    // Read importedFrom from parent gqlquery
    const importedFrom = React.useMemo(() => {
      if (typeof props.getPos !== 'function') return props.node.attrs.importedFrom;
      const pos = props.getPos();
      if (typeof pos !== 'number') return props.node.attrs.importedFrom;
      try {
        const $pos = props.editor.state.doc.resolve(pos);
        for (let d = $pos.depth - 1; d >= 0; d--) {
          const ancestor = $pos.node(d);
          if (ancestor.type.name === 'gqlquery') {
            return ancestor.attrs.importedFrom;
          }
        }
      } catch (e) {}
      return props.node.attrs.importedFrom;
    }, [props.editor.state, props.node.attrs.importedFrom]);

    // Initial sync
    React.useEffect(() => {
      const timer = setTimeout(() => {
        const doc = props.editor.state.doc;
        doc.descendants((node: any) => {
          if (node.type.name === 'gqlvariables') {
            const firstOperation = availableOperations[0]?.name;
            if (firstOperation && props.node.attrs.body) {
              const selectedArgs = operationArgSelections[firstOperation] || new Set();
              const currentVariables = node.attrs.body;
              const newVariables = generateVariablesFromQuery(
                props.node.attrs.body,
                currentVariables,
                firstOperation,
                selectedArgs
              );
              if (!currentVariables || currentVariables.trim() === '' || currentVariables === '{}') {
                doc.descendants((n: any, pos: number) => {
                  if (n.type.name === 'gqlvariables') {
                    const tr = props.editor.state.tr;
                    tr.setNodeMarkup(pos, null, { ...n.attrs, body: newVariables });
                    props.editor.view.dispatch(tr);
                    return false;
                  }
                });
              }
            }
            return false;
          }
        });
      }, 100);
      return () => clearTimeout(timer);
    }, []);

    // Pre-fill connectionUrl from doc URL node
    React.useEffect(() => {
      if (showConnectionInput && !connectionUrl) {
        const doc = props.editor.state.doc;
        let foundUrl = '';
        doc.descendants((node: any) => {
          if (node.type.name === 'url' && node.textContent) {
            foundUrl = node.textContent;
            return false;
          }
        });
        setConnectionUrl(foundUrl || 'http://');
      }
    }, [showConnectionInput]);

    React.useEffect(() => {
      if (props.node.attrs.schemaUrl !== connectionUrl) {
        props.updateAttributes({ schemaUrl: connectionUrl });
      }
    }, [connectionUrl]);

    const introspectionQuery = `
      query IntrospectionQuery {
        __schema {
          queryType { name }
          mutationType { name }
          subscriptionType { name }
          types {
            ...FullType
          }
        }
      }
      fragment FullType on __Type {
        kind
        name
        description
        fields(includeDeprecated: true) {
          name
          description
          args {
            ...InputValue
          }
          type {
            ...TypeRef
          }
        }
        inputFields {
          ...InputValue
        }
        interfaces {
          ...TypeRef
        }
        enumValues(includeDeprecated: true) {
          name
          description
        }
        possibleTypes {
          ...TypeRef
        }
      }
      fragment InputValue on __InputValue {
        name
        description
        type { ...TypeRef }
        defaultValue
      }
      fragment TypeRef on __Type {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                  ofType {
                    kind
                    name
                    ofType {
                      kind
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const parseIntrospectionToSchema = (introspectionData: any): ParsedSchema | null => {
      try {
        const schemaData = introspectionData.data.__schema;
        const types = schemaData.types;
        const queryTypeName = schemaData.queryType?.name;
        const mutationTypeName = schemaData.mutationType?.name;
        const subscriptionTypeName = schemaData.subscriptionType?.name;
        const queryType = types.find((t: any) => t.name === queryTypeName);
        const mutationType = types.find((t: any) => t.name === mutationTypeName);
        const subscriptionType = types.find((t: any) => t.name === subscriptionTypeName);

        const parseTypeRef = (typeRef: any): string => {
          if (!typeRef) return 'String';
          if (typeRef.kind === 'NON_NULL') return parseTypeRef(typeRef.ofType) + '!';
          if (typeRef.kind === 'LIST') return '[' + parseTypeRef(typeRef.ofType) + ']';
          return typeRef.name || 'String';
        };

        const parseField = (field: any): GraphQLField => ({
          name: field.name,
          type: parseTypeRef(field.type),
          args: field.args?.map((arg: any) => ({ name: arg.name, type: parseTypeRef(arg.type) })) || []
        });

        const queries = queryType?.fields?.map(parseField) || [];
        const mutations = mutationType?.fields?.map(parseField) || [];
        const subscriptions = subscriptionType?.fields?.map(parseField) || [];
        const parsedTypes: GraphQLType[] = types
          .filter((t: any) => !t.name.startsWith('__'))
          .map((t: any) => ({ name: t.name, fields: t.fields?.map(parseField) || [] }));

        return { queries, mutations, subscriptions, types: parsedTypes };
      } catch (error) {
        return null;
      }
    };

    const handleConnect = async () => {
      if (!connectionUrl || connectionUrl === 'http://') {
        setConnectionError('Please enter a valid URL');
        return;
      }
      setIsConnecting(true);
      setConnectionError('');
      try {
        const requestState = {
          method: 'POST',
          url: connectionUrl,
          headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
          body: JSON.stringify({ query: introspectionQuery }),
          queryParams: [],
          pathParams: [],
        };
        const response = await (window as any).electron?.request?.sendSecure(requestState);
        if (!response || !response.status || response.status < 200 || response.status >= 300) {
          throw new Error(`HTTP ${response?.status || 'N/A'}: ${response?.statusText || 'Unknown error'}`);
        }
        let data;
        if (response.body) {
          const buffer = Buffer.from(response.body);
          const bodyText = buffer.toString();
          try { data = JSON.parse(bodyText); }
          catch (e) { throw new Error('Invalid JSON response. Make sure the URL points to a GraphQL endpoint.'); }
        } else {
          throw new Error('No response body received from the server.');
        }
        if (data.errors && data.errors.length > 0) throw new Error(`GraphQL Error: ${data.errors[0].message}`);
        const parsedSchema = parseIntrospectionToSchema(data);
        if (parsedSchema) {
          setSchema(parsedSchema);
          props.updateAttributes({ schemaUrl: connectionUrl, schemaFileName: null, schemaFilePath: null });
          setShowConnectionInput(false);
          setConnectionError('');
        } else {
          setConnectionError('Failed to parse schema.');
        }
      } catch (error: any) {
        setConnectionError(error.message || 'Failed to connect to GraphQL endpoint');
      } finally {
        setIsConnecting(false);
      }
    };

    const availableOperations = React.useMemo(() => {
      return extractOperations(editorQuery || props.node.attrs.body || '');
    }, [editorQuery, props.node.attrs.body]);

    React.useEffect(() => {
      if (availableOperations.length > 0) {
        const firstOp = availableOperations[0];
        if (firstOp && firstOp.type !== props.node.attrs.operationType) {
          props.updateAttributes({ operationType: firstOp.type });
        }
      }
    }, [availableOperations]);

    React.useEffect(() => {
      if (mode === 'viewer' && editorQuery !== props.node.attrs.body) {
        props.updateAttributes({ body: editorQuery });
      }
    }, [mode]);

    React.useEffect(() => {
      if (!schema || !editorQuery) return;
      const allSchemaOperations = [
        ...(schema.queries || []).map(q => ({ ...q, operationType: 'query' })),
        ...(schema.mutations || []).map(m => ({ ...m, operationType: 'mutation' })),
        ...(schema.subscriptions || []).map(s => ({ ...s, operationType: 'subscription' }))
      ];
      const parsed = parseQuerySelections(editorQuery, allSchemaOperations);
      setSelectedOperations(parsed.selectedOperations);
      setOperationFieldSelections(parsed.operationFieldSelections);
      setOperationArgSelections(parsed.operationArgSelections);
      setFieldArgSelections(parsed.fieldArgSelections);
      setNestedFieldSelections(parsed.nestedFieldSelections);
    }, [schema, editorQuery]);

    React.useEffect(() => {
      if (props.node.attrs.schemaFilePath && props.node.attrs.schemaFileName && props.node.attrs.schemaUrl) {
        props.updateAttributes({ schemaUrl: null });
        if (!schema) loadSchemaFile();
        return;
      }
      if (props.node.attrs.schemaFilePath && props.node.attrs.schemaFileName && !schema) {
        loadSchemaFile();
        return;
      }
      if (props.node.attrs.schemaUrl && !props.node.attrs.schemaFileName && !props.node.attrs.schemaFilePath && !schema) {
        loadSchemaFromUrl();
        return;
      }
    }, []);

    const loadSchemaFile = async () => {
      const filePath = props.node.attrs.schemaFilePath;
      if (!filePath) return;
      try {
        const parsed = await loadSchemaFileUtil(filePath);
        if (parsed) setSchema(parsed);
      } catch (error) {}
    };

    const loadSchemaFromUrl = async () => {
      const url = props.node.attrs.schemaUrl;
      if (!url) return;
      try {
        const requestState = {
          method: 'POST', url,
          headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
          body: JSON.stringify({ query: introspectionQuery }),
          queryParams: [], pathParams: [],
        };
        const response = await (window as any).electron?.request?.sendSecure(requestState);
        if (!response || !response.status || response.status < 200 || response.status >= 300) {
          setShowConnectionInput(true);
          setConnectionError('Failed to load schema from URL: ' + response?.statusText);
          return;
        }
        let data;
        if (response.body) {
          const buffer = Buffer.from(response.body);
          const bodyText = buffer.toString();
          try { data = JSON.parse(bodyText); } catch (e) { return; }
        } else { return; }
        const parsedSchema = parseIntrospectionToSchema(data);
        if (parsedSchema) setSchema(parsedSchema);
      } catch (error) {}
    };

    const handleEditorChange = (newContent: string) => {
      setEditorQuery(newContent);
      props.updateAttributes({ body: newContent });
      if (schema) {
        const operations = extractOperations(newContent);
        const newSelectedOperations = new Set<string>();
        const newOperationFieldSelections: Record<string, Set<string>> = {};
        const newOperationArgSelections: Record<string, Set<string>> = {};
        const newFieldArgSelections: Record<string, Record<string, Set<string>>> = {};
        operations.forEach(op => {
          const opName = op.name;
          if (isOperationInQuery(newContent, opName)) {
            newSelectedOperations.add(opName);
            const fields = parseQueryFields(newContent, opName);
            newOperationFieldSelections[opName] = fields;
            const opArgPattern = new RegExp(`${op.type}\\s+${opName}\\s*\\(([^)]*)\\)`, 's');
            const opArgMatch = newContent.match(opArgPattern);
            if (opArgMatch && opArgMatch[1]) {
              const argNames = new Set<string>();
              const argRegex = /\$(\w+)\s*:/g;
              let match;
              while ((match = argRegex.exec(opArgMatch[1])) !== null) argNames.add(match[1]);
              newOperationArgSelections[opName] = argNames;
            }
            fields.forEach(fieldName => {
              const fieldPattern = new RegExp(`${fieldName}\\s*\\(([^)]*)\\)`, 's');
              const fieldMatch = newContent.match(fieldPattern);
              if (fieldMatch && fieldMatch[1]) {
                const argNames = new Set<string>();
                const argRegex = /(\w+)\s*:/g;
                let match;
                while ((match = argRegex.exec(fieldMatch[1])) !== null) argNames.add(match[1]);
                if (!newFieldArgSelections[opName]) newFieldArgSelections[opName] = {};
                newFieldArgSelections[opName][fieldName] = argNames;
              }
            });
          }
        });
        setSelectedOperations(newSelectedOperations);
        setOperationFieldSelections(newOperationFieldSelections);
        setOperationArgSelections(newOperationArgSelections);
        setFieldArgSelections(newFieldArgSelections);
      }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.name.endsWith('.graphql') && !file.name.endsWith('.gql')) {
        alert('Please upload a .graphql or .gql file');
        return;
      }
      try {
        const electronFile = file as File & { path?: string };
        const filePath = electronFile.path || electronFile.webkitRelativePath;
        if (!filePath) { alert('Could not get file path'); return; }
        const electronApi = (window as any).electron;
        if (!electronApi?.files?.read) { alert('File API not available'); return; }
        const content = await electronApi.files.read(filePath);
        const parsed = parseGraphQLSchema(content);
        props.updateAttributes({ schemaFileName: file.name, schemaFilePath: filePath, schemaUrl: null });
        setSchema(parsed);
      } catch (error) {
        alert('Failed to read schema file');
      }
    };

    const handleOperationToggle = (operationName: string) => {
      setExpandedOperations(prev => {
        const newSet = new Set(prev);
        if (newSet.has(operationName)) {
          newSet.delete(operationName);
        } else {
          const isQuery = schema?.queries?.some(q => q.name === operationName);
          const isMutation = schema?.mutations?.some(m => m.name === operationName);
          const isSubscription = schema?.subscriptions?.some(s => s.name === operationName);
          newSet.clear();
          if (isQuery) setActiveTab('query');
          else if (isMutation) setActiveTab('mutation');
          else if (isSubscription) setActiveTab('subscription');
          newSet.add(operationName);
          if (!operationFieldSelections[operationName]) {
            setOperationFieldSelections(prevSelections => ({ ...prevSelections, [operationName]: new Set() }));
            const currentOp = [...(schema?.queries || []), ...(schema?.mutations || []), ...(schema?.subscriptions || [])].find(op => op.name === operationName);
            if (currentOp && props.node.attrs.body) parseQueryForOperation(currentOp, operationName);
          }
        }
        return newSet;
      });
    };

    const handleOperationSelect = (operationName: string, checked: boolean) => {
      setSelectedOperations(prev => {
        const newSet = new Set(prev);
        if (checked) {
          const isQuery = schema?.queries?.some(q => q.name === operationName);
          const isMutation = schema?.mutations?.some(m => m.name === operationName);
          const isSubscription = schema?.subscriptions?.some(s => s.name === operationName);
          let hasConflictingType = false;
          const operationsToRemove: string[] = [];
          prev.forEach(selectedOp => {
            const selectedIsQuery = schema?.queries?.some(q => q.name === selectedOp);
            const selectedIsMutation = schema?.mutations?.some(m => m.name === selectedOp);
            const selectedIsSubscription = schema?.subscriptions?.some(s => s.name === selectedOp);
            if ((isQuery && (selectedIsMutation || selectedIsSubscription)) ||
              (isMutation && (selectedIsQuery || selectedIsSubscription)) ||
              (isSubscription && (selectedIsQuery || selectedIsMutation))) {
              hasConflictingType = true;
              operationsToRemove.push(selectedOp);
            }
            if (isSubscription && selectedIsSubscription && selectedOp !== operationName) operationsToRemove.push(selectedOp);
          });
          if (hasConflictingType || operationsToRemove.length > 0) {
            operationsToRemove.forEach(opName => {
              newSet.delete(opName);
              setOperationFieldSelections(prev => { const n = { ...prev }; delete n[opName]; return n; });
              setOperationArgSelections(prev => { const n = { ...prev }; delete n[opName]; return n; });
              setFieldArgSelections(prev => { const n = { ...prev }; delete n[opName]; return n; });
              setNestedFieldSelections(prev => { const n = { ...prev }; delete n[opName]; return n; });
            });
            setEditorQuery('');
            props.updateAttributes({ body: '' });
          }
          newSet.add(operationName);
        } else {
          newSet.delete(operationName);
          setOperationFieldSelections(prev => { const n = { ...prev }; delete n[operationName]; return n; });
          setOperationArgSelections(prev => { const n = { ...prev }; delete n[operationName]; return n; });
          setFieldArgSelections(prev => { const n = { ...prev }; delete n[operationName]; return n; });
          setNestedFieldSelections(prev => { const n = { ...prev }; delete n[operationName]; return n; });
        }
        return newSet;
      });
    };

    const handleOperationArgToggle = (operationName: string, argName: string) => {
      setOperationArgSelections(prev => {
        const newSelections = { ...prev };
        if (!newSelections[operationName]) newSelections[operationName] = new Set();
        else newSelections[operationName] = new Set(newSelections[operationName]);
        const args = newSelections[operationName];
        if (args.has(argName)) args.delete(argName);
        else args.add(argName);
        return newSelections;
      });
    };

    const parseQueryForOperation = (operation: GraphQLField, operationName: string) => {
      const body = props.node.attrs.body;
      if (!body) return;
      if (isOperationInQuery(body, operation.name)) setSelectedOperations(prev => new Set(prev).add(operationName));
      const parsedFields = parseQueryFields(body, operation.name);
      setOperationFieldSelections(prev => ({ ...prev, [operationName]: parsedFields }));
    };

    const handleFieldToggle = (operationName: string, fieldName: string) => {
      setOperationFieldSelections(prev => {
        const current = prev[operationName] || new Set();
        const newFields = new Set(current);
        if (newFields.has(fieldName)) {
          newFields.delete(fieldName);
          setNestedFieldSelections(prevNested => {
            const newNested = { ...prevNested };
            if (newNested[operationName]) {
              newNested[operationName] = { ...newNested[operationName] };
              Object.keys(newNested[operationName]).forEach(path => {
                if (path === fieldName || path.startsWith(`${fieldName}.`)) delete newNested[operationName][path];
              });
            }
            return newNested;
          });
          setFieldArgSelections(prevArgs => {
            const newArgs = { ...prevArgs };
            if (newArgs[operationName]) {
              newArgs[operationName] = { ...newArgs[operationName] };
              delete newArgs[operationName][fieldName];
            }
            return newArgs;
          });
        } else {
          newFields.add(fieldName);
        }
        return { ...prev, [operationName]: newFields };
      });
    };

    const handleFieldArgToggle = (operationName: string, fieldPath: string, argName: string) => {
      setFieldArgSelections(prev => {
        const newSelections = { ...prev };
        if (!newSelections[operationName]) newSelections[operationName] = {};
        if (!newSelections[operationName][fieldPath]) newSelections[operationName][fieldPath] = new Set();
        const args = new Set(newSelections[operationName][fieldPath]);
        if (args.has(argName)) args.delete(argName);
        else args.add(argName);
        newSelections[operationName] = { ...newSelections[operationName], [fieldPath]: args };
        return newSelections;
      });
    };

    const handleNestedFieldToggle = (operationName: string, fieldPath: string, subfieldName: string) => {
      setNestedFieldSelections(prev => {
        const newSelections = { ...prev };
        if (!newSelections[operationName]) newSelections[operationName] = {};
        else newSelections[operationName] = { ...newSelections[operationName] };
        if (!newSelections[operationName][fieldPath]) newSelections[operationName][fieldPath] = new Set();
        else newSelections[operationName][fieldPath] = new Set(newSelections[operationName][fieldPath]);
        const subfields = newSelections[operationName][fieldPath];
        const isRemoving = subfields.has(subfieldName);
        if (isRemoving) {
          subfields.delete(subfieldName);
          const subfieldPath = `${fieldPath}.${subfieldName}`;
          Object.keys(newSelections[operationName]).forEach(path => {
            if (path === subfieldPath || path.startsWith(`${subfieldPath}.`)) delete newSelections[operationName][path];
          });
          setFieldArgSelections(prevArgs => {
            const newArgs = { ...prevArgs };
            if (newArgs[operationName]) {
              newArgs[operationName] = { ...newArgs[operationName] };
              delete newArgs[operationName][subfieldPath];
            }
            return newArgs;
          });
        } else {
          subfields.add(subfieldName);
          const pathParts = fieldPath.split('.');
          const topLevelField = pathParts[0];
          setOperationFieldSelections(prevFields => {
            const newFields = { ...prevFields };
            if (!newFields[operationName]) newFields[operationName] = new Set();
            else newFields[operationName] = new Set(newFields[operationName]);
            newFields[operationName].add(topLevelField);
            return newFields;
          });
          for (let i = 1; i < pathParts.length; i++) {
            const parentPath = pathParts.slice(0, i).join('.');
            const currentField = pathParts[i];
            if (!newSelections[operationName][parentPath]) newSelections[operationName][parentPath] = new Set();
            newSelections[operationName][parentPath].add(currentField);
          }
        }
        return newSelections;
      });
    };

    const renderField = (
      operationName: string,
      field: GraphQLField,
      fieldPath: string,
      depth: number = 0,
      isSelected: boolean,
      onToggle: () => void
    ): JSX.Element => {
      if (!schema) return <></>;
      const fieldArgSelection = fieldArgSelections[operationName]?.[fieldPath] || new Set();
      const returnTypeName = field.type.replace(/[\[\]!]/g, '');
      const returnType = schema.types.find(t => t.name.toLowerCase() === returnTypeName.toLowerCase());
      const hasSubfields = returnType && returnType.fields && returnType.fields.length > 0;
      const currentLevelNestedFields = nestedFieldSelections[operationName]?.[fieldPath] || new Set();

      return (
        <div key={`${operationName}.${fieldPath}`} className="space-y-1">
          <label className="flex items-center gap-2 text-xs cursor-pointer hover:bg-active p-1.5 rounded transition-colors">
            <input type="checkbox" checked={isSelected} onChange={onToggle} className="cursor-pointer" />
            <span className="font-mono text-text">{field.name}</span>
            <span className="text-comment">: {field.type}</span>
            {hasSubfields && <span className="text-comment text-[10px]">(has fields)</span>}
          </label>
          {field.args && field.args.length > 0 && isSelected && (
            <div className="ml-8 pl-2 border-l border-border space-y-1" style={{ marginLeft: `${depth * 1.5 + 2}rem` }}>
              {field.args.map((arg) => (
                <label key={arg.name} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-active p-1 rounded transition-colors">
                  <input type="checkbox" checked={fieldArgSelection.has(arg.name)} onChange={() => handleFieldArgToggle(operationName, fieldPath, arg.name)} className="cursor-pointer" />
                  <span className="font-mono text-comment">{arg.name}</span>
                  <span className="text-comment">: {arg.type}</span>
                </label>
              ))}
            </div>
          )}
          {hasSubfields && isSelected && returnType && (
            <div className="ml-4 pl-4 space-y-1">
              {returnType.fields.map((subfield) => {
                const subfieldPath = `${fieldPath}.${subfield.name}`;
                const isSubfieldSelected = currentLevelNestedFields.has(subfield.name);
                return renderField(operationName, subfield, subfieldPath, depth + 1, isSubfieldSelected, () => handleNestedFieldToggle(operationName, fieldPath, subfield.name));
              })}
            </div>
          )}
        </div>
      );
    };

    React.useEffect(() => {
      if (!schema || mode !== 'viewer') return;
      if (selectedOperations.size === 0) return;
      const result = generateQuery({ schema, selectedOperations, operationFieldSelections, fieldArgSelections, operationArgSelections, nestedFieldSelections, activeTab });
      if (result.query && result.query !== editorQuery) {
        setEditorQuery(result.query);
        props.updateAttributes({ body: result.query, operationType: result.operationType });
      }
    }, [selectedOperations, operationFieldSelections, fieldArgSelections, operationArgSelections, nestedFieldSelections, schema, activeTab, mode]);

    const syncVariables = React.useCallback(() => {
      const firstOperation = availableOperations[0]?.name;
      if (!firstOperation || !props.node.attrs.body) return;
      const doc = props.editor.state.doc;
      let variablesNodePos: number | null = null;
      let variablesNode: any = null;
      doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'gqlvariables') { variablesNode = node; variablesNodePos = pos; return false; }
      });
      if (variablesNode && variablesNodePos !== null) {
        const selectedArgs = operationArgSelections[firstOperation] || new Set();
        const currentVariables = variablesNode.attrs.body;
        const newVariables = generateVariablesFromQuery(props.node.attrs.body, currentVariables, firstOperation, selectedArgs);
        if (newVariables !== currentVariables) {
          const tr = props.editor.state.tr;
          tr.setNodeMarkup(variablesNodePos, null, { ...variablesNode.attrs, body: newVariables });
          props.editor.view.dispatch(tr);
        }
      }
    }, [props.node.attrs.body, availableOperations, operationArgSelections, props.editor]);

    React.useEffect(() => { syncVariables(); }, [syncVariables]);

    React.useEffect(() => {
      props.editor.on('update', syncVariables);
      return () => { props.editor.off('update', syncVariables); };
    }, [props.editor, syncVariables]);

    const hasSchema = (props.node.attrs.schemaFileName || props.node.attrs.schemaUrl) && schema;
    const isEditable = props.editor.isEditable;

    return (
      <NodeViewWrapper>
        <div>
          {/* Schema file selector */}
          {!props.node.attrs.schemaFileName && !props.node.attrs.schemaUrl && !showConnectionInput ? (
            isEditable ? (
              <div className="bg-panel border-t border-b border-border px-3 py-2">
                <input ref={fileInputRef} type="file" accept=".graphql,.gql" onChange={handleFileSelect} className="hidden" id="graphql-schema-input" />
                <div className="flex items-center gap-3">
                  <button type="button" className="text-sm text-accent hover:text-accent/80 transition-colors cursor-pointer flex items-center gap-1.5 group" onClick={() => { setShowConnectionInput(false); fileInputRef.current?.click(); }} title="Import schema">
                    <FileDown className="w-4 h-4" />
                  </button>
                  <button type="button" className="text-sm text-accent hover:text-accent/80 transition-colors cursor-pointer flex items-center gap-1.5 group" onClick={() => setShowConnectionInput(!showConnectionInput)} title="Connect to GraphQL endpoint">
                    <Link className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : null
          ) : (
            <div className="bg-panel border-t border-b border-border px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-sm font-medium text-comment cursor-text">
                    {props.node.attrs.schemaFileName || props.node.attrs.schemaUrl}
                  </span>
                </div>
                {isEditable && (
                  <button className="text-xs px-2 py-1 text-red-400 hover:text-text hover:bg-active rounded transition-colors"
                    onClick={() => {
                      props.updateAttributes({ schemaFileName: null, schemaFilePath: null, schemaUrl: null });
                      setSchema(null);
                      setShowConnectionInput(false);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}>
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Connection URL input */}
          {isEditable && showConnectionInput && !props.node.attrs.schemaFileName && (
            <div className="bg-panel border-b border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <input type="text" value={connectionUrl} onChange={(e) => { setConnectionUrl(e.target.value); if (connectionError) setConnectionError(''); }}
                  placeholder="http://"
                  className="flex-1 px-3 py-1.5 bg-editor border border-border rounded text-sm text-text placeholder-comment focus:outline-none focus:border-accent transition-colors font-mono"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) handleConnect(); }}
                />
                <button onClick={handleConnect} disabled={isConnecting}
                  className="px-3 py-1.5 bg-accent hover:bg-accent/80 disabled:bg-accent/50 text-white rounded text-sm flex items-center gap-1.5 transition-colors"
                  title="Connect to endpoint">
                  {isConnecting ? (<><Loader2 className="w-4 h-4 animate-spin" /><span>Connecting...</span></>) : (<><Link className="w-4 h-4" /><span>Connect</span></>)}
                </button>
              </div>
              {connectionError && (
                <div className="p-2 text-xs italic text-red-400 flex items-center gap-2">
                  <CircleX size={14} /> {connectionError}
                </div>
              )}
            </div>
          )}

          {/* Mode toggle */}
          <div className="bg-panel border-b border-border px-3 py-2 flex items-center gap-2">
            {hasSchema && isEditable && (
              <>
                <button onClick={() => setMode('editor')} className={`p-1.5 rounded transition-colors ${mode === 'editor' ? 'bg-accent/30 text-text' : 'text-comment hover:text-text hover:bg-active'}`} title="Editor mode">
                  <Pen className="w-4 h-4" />
                </button>
                <button onClick={() => setMode('viewer')} className={`p-1.5 rounded transition-colors ${mode === 'viewer' ? 'bg-accent/30 text-text' : 'text-comment hover:text-text hover:bg-active'}`} title="Viewer mode">
                  <Eye className="w-4 h-4" />
                </button>
              </>
            )}
          </div>

          {/* Content area */}
          {mode === 'editor' || !hasSchema ? (
            <div className="border border-border" style={{ height: 'auto' }}>
              <CodeEditor
                tiptapProps={{
                  ...props,
                  node: { ...props.node, attrs: { ...props.node.attrs, body: editorQuery } },
                  updateAttributes: (attrs: any) => {
                    if (attrs.body !== undefined) {
                      setEditorQuery(attrs.body);
                      props.updateAttributes({ body: attrs.body });
                    }
                  }
                }}
                lang="graphql"
                showReplace={false}
                autofocus={isEditable && !importedFrom}
                readOnly={!isEditable || !!importedFrom}
                onChange={handleEditorChange}
              />
            </div>
          ) : (
            <div className="bg-editor border border-border">
              {schema && (
                <div>
                  <div className="flex border-b border-border">
                    {schema.queries.length > 0 && (
                      <button onClick={() => { setActiveTab('query'); setExpandedOperations(new Set()); }}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'query' ? 'bg-active text-accent border-b-2 border-accent' : 'text-comment hover:text-text hover:bg-panel'}`}>
                        Query ({schema.queries.length})
                      </button>
                    )}
                    {schema.mutations.length > 0 && (
                      <button onClick={() => { setActiveTab('mutation'); setExpandedOperations(new Set()); }}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'mutation' ? 'bg-active text-accent border-b-2 border-accent' : 'text-comment hover:text-text hover:bg-panel'}`}>
                        Mutation ({schema.mutations.length})
                      </button>
                    )}
                    {schema.subscriptions.length > 0 && (
                      <button onClick={() => { setActiveTab('subscription'); setExpandedOperations(new Set()); }}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'subscription' ? 'bg-active text-accent border-b-2 border-accent' : 'text-comment hover:text-text hover:bg-panel'}`}>
                        Subscription ({schema.subscriptions.length})
                      </button>
                    )}
                  </div>

                  <div className="p-4 max-h-96 overflow-y-auto">
                    <div className="space-y-2">
                      {activeTab === 'query' && schema.queries.map((query) => {
                        const isExpanded = expandedOperations.has(query.name);
                        const isSelected = selectedOperations.has(query.name);
                        const fields = operationFieldSelections[query.name] || new Set();
                        const returnTypeName = query.type.replace(/[\[\]!]/g, '');
                        const returnType = schema.types.find(t => t.name === returnTypeName);
                        const queryName = query.name;
                        return (
                          <div key={query.name} ref={(el) => { if (isExpanded && el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}
                            className="border border-border rounded overflow-hidden">
                            <div className="flex items-center bg-panel hover:bg-active transition-colors cursor-pointer">
                              <label className="flex items-center px-3 py-2">
                                <input type="checkbox" checked={isSelected} onChange={(e) => handleOperationSelect(query.name, e.target.checked)} className="cursor-pointer" onClick={(e) => e.stopPropagation()} />
                              </label>
                              <button onClick={() => handleOperationToggle(query.name)} className="flex-1 text-left px-3 py-2 flex items-center justify-between">
                                <div className="flex-1">
                                  <div className="font-mono text-sm text-text">{query.name}</div>
                                  <div className="text-xs text-comment mt-0.5">Returns: {query.type}</div>
                                </div>
                                <div className="text-comment">{isExpanded ? '▼' : '▶'}</div>
                              </button>
                            </div>
                            {isExpanded && (
                              <div className="bg-editor p-3 border-t border-border">
                                {query.args && query.args.length > 0 && (
                                  <div className="mb-3">
                                    <h5 className="text-xs font-semibold text-text mb-2">Arguments:</h5>
                                    <div className="space-y-1.5 pl-2">
                                      {query.args.map((arg) => {
                                        const operationArgSelection = operationArgSelections[query.name] || new Set();
                                        return (
                                          <label key={arg.name} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-active p-1 rounded transition-colors">
                                            <input type="checkbox" checked={operationArgSelection.has(arg.name)} onChange={() => handleOperationArgToggle(query.name, arg.name)} className="cursor-pointer" />
                                            <span className="font-mono text-text">{arg.name}</span>
                                            <span className="text-comment">: {arg.type}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                                <div>
                                  <h5 className="text-xs font-semibold text-text mb-2">Fields to return:</h5>
                                  {returnType && returnType.fields && returnType.fields.length > 0 ? (
                                    <div className="space-y-1.5">
                                      {returnType.fields.map((field) => (
                                        <React.Fragment key={`${queryName}-${field.name}`}>
                                          {renderField(queryName, field, field.name, 0, fields.has(field.name), () => handleFieldToggle(queryName, field.name))}
                                        </React.Fragment>
                                      ))}
                                    </div>
                                  ) : (<div className="text-xs text-comment">Scalar type or no fields available</div>)}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {activeTab === 'mutation' && schema.mutations.map((mutation) => {
                        const isExpanded = expandedOperations.has(mutation.name);
                        const isSelected = selectedOperations.has(mutation.name);
                        const fields = operationFieldSelections[mutation.name] || new Set();
                        const returnTypeName = mutation.type.replace(/[\[\]!]/g, '');
                        const returnType = schema.types.find(t => t.name === returnTypeName);
                        const mutationName = mutation.name;
                        return (
                          <div key={mutation.name} ref={(el) => { if (isExpanded && el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}
                            className="border border-border rounded overflow-hidden">
                            <div className="flex items-center bg-panel hover:bg-active transition-colors cursor-pointer">
                              <label className="flex items-center px-3 py-2">
                                <input type="checkbox" checked={isSelected} onChange={(e) => handleOperationSelect(mutation.name, e.target.checked)} className="cursor-pointer" onClick={(e) => e.stopPropagation()} />
                              </label>
                              <button onClick={() => handleOperationToggle(mutation.name)} className="flex-1 text-left px-3 py-2 flex items-center justify-between">
                                <div className="flex-1">
                                  <div className="font-mono text-sm text-text">{mutation.name}</div>
                                  <div className="text-xs text-comment mt-0.5">Returns: {mutation.type}</div>
                                </div>
                                <div className="text-comment">{isExpanded ? '▼' : '▶'}</div>
                              </button>
                            </div>
                            {isExpanded && (
                              <div className="bg-editor p-3 border-t border-border">
                                {mutation.args && mutation.args.length > 0 && (
                                  <div className="mb-3">
                                    <h5 className="text-xs font-semibold text-text mb-2">Arguments:</h5>
                                    <div className="space-y-1.5 pl-2">
                                      {mutation.args.map((arg) => {
                                        const operationArgSelection = operationArgSelections[mutation.name] || new Set();
                                        return (
                                          <label key={arg.name} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-active p-1 rounded transition-colors">
                                            <input type="checkbox" checked={operationArgSelection.has(arg.name)} onChange={() => handleOperationArgToggle(mutation.name, arg.name)} className="cursor-pointer" />
                                            <span className="font-mono text-text">{arg.name}</span>
                                            <span className="text-comment">: {arg.type}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                                <div>
                                  <h5 className="text-xs font-semibold text-text mb-2">Fields to return:</h5>
                                  {returnType && returnType.fields && returnType.fields.length > 0 ? (
                                    <div className="space-y-1.5">
                                      {returnType.fields.map((field) => (
                                        <React.Fragment key={`${mutationName}-${field.name}`}>
                                          {renderField(mutationName, field, field.name, 0, fields.has(field.name), () => handleFieldToggle(mutationName, field.name))}
                                        </React.Fragment>
                                      ))}
                                    </div>
                                  ) : (<div className="text-xs text-comment">Scalar type or no fields available</div>)}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {activeTab === 'subscription' && schema.subscriptions.map((subscription) => {
                        const isExpanded = expandedOperations.has(subscription.name);
                        const isSelected = selectedOperations.has(subscription.name);
                        const fields = operationFieldSelections[subscription.name] || new Set();
                        const returnTypeName = subscription.type.replace(/[\[\]!]/g, '');
                        const returnType = schema.types.find(t => t.name === returnTypeName);
                        const subscriptionName = subscription.name;
                        return (
                          <div key={subscription.name} ref={(el) => { if (isExpanded && el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}
                            className="border border-border rounded overflow-hidden">
                            <div className="flex items-center bg-panel hover:bg-active transition-colors cursor-pointer">
                              <label className="flex items-center px-3 py-2">
                                <input type="checkbox" checked={isSelected} onChange={(e) => handleOperationSelect(subscription.name, e.target.checked)} className="cursor-pointer" onClick={(e) => e.stopPropagation()} />
                              </label>
                              <button onClick={() => handleOperationToggle(subscription.name)} className="flex-1 text-left px-3 py-2 flex items-center justify-between">
                                <div className="flex-1">
                                  <div className="font-mono text-sm text-text">{subscription.name}</div>
                                  <div className="text-xs text-comment mt-0.5">Returns: {subscription.type}</div>
                                </div>
                                <div className="text-comment">{isExpanded ? '▼' : '▶'}</div>
                              </button>
                            </div>
                            {isExpanded && (
                              <div className="bg-editor p-3 border-t border-border">
                                {subscription.args && subscription.args.length > 0 && (
                                  <div className="mb-3">
                                    <h5 className="text-xs font-semibold text-text mb-2">Arguments:</h5>
                                    <div className="space-y-1.5 pl-2">
                                      {subscription.args.map((arg) => {
                                        const operationArgSelection = operationArgSelections[subscription.name] || new Set();
                                        return (
                                          <label key={arg.name} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-active p-1 rounded transition-colors">
                                            <input type="checkbox" checked={operationArgSelection.has(arg.name)} onChange={() => handleOperationArgToggle(subscription.name, arg.name)} className="cursor-pointer" />
                                            <span className="font-mono text-text">{arg.name}</span>
                                            <span className="text-comment">: {arg.type}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                                <div>
                                  <h5 className="text-xs font-semibold text-text mb-2">Fields to return:</h5>
                                  {returnType && returnType.fields && returnType.fields.length > 0 ? (
                                    <div className="space-y-1.5">
                                      {returnType.fields.map((field) => (
                                        <React.Fragment key={`${subscriptionName}-${field.name}`}>
                                          {renderField(subscriptionName, field, field.name, 0, fields.has(field.name), () => handleFieldToggle(subscriptionName, field.name))}
                                        </React.Fragment>
                                      ))}
                                    </div>
                                  ) : (<div className="text-xs text-comment">Scalar type or no fields available</div>)}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {schema.queries.length === 0 && schema.mutations.length === 0 && schema.subscriptions.length === 0 && (
                    <div className="text-sm text-comment text-center py-4">No operations found in schema</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </NodeViewWrapper>
    );
  };

  return Node.create({
    name: "gqlbody",
    group: "",
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
      return {
        body: { default: "" },
        operationType: { default: "query" },
        schemaFileName: { default: null },
        schemaFilePath: { default: null },
        schemaUrl: { default: null },
        importedFrom: { default: undefined },
      };
    },

    parseHTML() {
      return [{ tag: "gqlbody" }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["gqlbody", mergeAttributes(HTMLAttributes)];
    },

    addNodeView() {
      return ReactNodeViewRenderer(GqlBodyComponent);
    },

    addKeyboardShortcuts() {
      return {
        Backspace: ({ editor }) => {
          const { selection } = editor.state;
          const node = selection.$from.node();
          if (node?.type.name === 'gqlbody') return true;
          return false;
        },
        Delete: ({ editor }) => {
          const { selection } = editor.state;
          const node = selection.$from.node();
          if (node?.type.name === 'gqlbody') return true;
          return false;
        },
      };
    },
  });
};

export const GqlBodyNode = createGqlBodyNode(
  ({ children }: any) => <div>{children}</div>,
  () => <div>CodeEditor not available</div>
);
