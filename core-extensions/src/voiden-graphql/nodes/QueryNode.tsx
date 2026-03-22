/**
 * GraphQL Query Node
 *
 * Code block for GraphQL query/mutation/subscription
 */

import React from "react";
import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Eye, Pen, ExternalLink, FileDown, Link, Loader2, X, CircleX, Play } from "lucide-react";
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

export const createGraphQLQueryNode = (NodeViewWrapper: any, CodeEditor: any, RequestBlockHeader: any, useSendRestRequest?: any) => {
  const getDefaultTemplate = (type: string) => {
    switch (type) {
      case 'mutation':
        return 'mutation UpdateData {\n  # Write your GraphQL mutation\n  # Example:\n  # updateUser(id: "1", input: { name: "John" }) {\n  #   id\n  #   name\n  # }\n}';
      case 'subscription':
        return 'subscription OnDataChange {\n  # Write your GraphQL subscription\n  # Example:\n  # userUpdated(id: "1") {\n  #   id\n  #   name\n  # }\n}';
      default:
        return 'query GetData {\n  # Write your GraphQL query\n  # Example:\n  # user(id: "1") {\n  #   name\n  #   email\n  # }\n}';
    }
  };

  const GraphQLQueryComponent = (props: any) => {
    const sendRequest = useSendRestRequest ? useSendRestRequest(props.editor) : null;
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [mode, setMode] = React.useState<'editor' | 'viewer'>('editor');
    const [schema, setSchema] = React.useState<ParsedSchema | null>(null);
    const [expandedOperations, setExpandedOperations] = React.useState<Set<string>>(new Set());
    const [selectedOperations, setSelectedOperations] = React.useState<Set<string>>(new Set());
    const [activeTab, setActiveTab] = React.useState<'query' | 'mutation' | 'subscription'>('query');
    const [showConnectionInput, setShowConnectionInput] = React.useState(false);
    const [endpointUrl, setEndpointUrl] = React.useState(props.node.attrs.endpoint || '');
    const [connectionUrl, setConnectionUrl] = React.useState(props.node.attrs.schemaUrl || '');
    const [isConnecting, setIsConnecting] = React.useState(false);
    const [connectionError, setConnectionError] = React.useState('');

    // Local state for editor content (only saved to props on mode switch)
    const [editorQuery, setEditorQuery] = React.useState<string>(
      props.node.attrs.body || ''
    );
    // Track field selections per operation: { operationName: Set<fieldName> }
    const [operationFieldSelections, setOperationFieldSelections] = React.useState<Record<string, Set<string>>>({});
    // Track field argument selections: { operationName: { fieldName: Set<argName> } }
    const [fieldArgSelections, setFieldArgSelections] = React.useState<Record<string, Record<string, Set<string>>>>({});
    // Track operation argument selections: { operationName: Set<argName> }
    const [operationArgSelections, setOperationArgSelections] = React.useState<Record<string, Set<string>>>({});
    // Track nested field selections: { operationName: { fieldPath: Set<subfieldName> } }
    // fieldPath is like "todos" or "user.posts" for deeply nested fields
    const [nestedFieldSelections, setNestedFieldSelections] = React.useState<Record<string, Record<string, Set<string>>>>({});

    // Initial sync on mount
    React.useEffect(() => {
      // Small delay to ensure variables node is mounted if it exists
      const timer = setTimeout(() => {
        const doc = props.editor.state.doc;
        doc.descendants((node: any) => {
          if (node.type.name === 'gqlvariables') {
            // Trigger sync if variables node exists
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
                // Force update on empty variables node
                doc.descendants((n: any, pos: number) => {
                  if (n.type.name === 'gqlvariables') {
                    const tr = props.editor.state.tr;
                    tr.setNodeMarkup(pos, null, {
                      ...n.attrs,
                      body: newVariables
                    });
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

    // Get URL from editor document if exists
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

    // Sync endpoint URL to node attributes
    React.useEffect(() => {
      if (props.node.attrs.endpoint !== endpointUrl) {
        props.updateAttributes({
          endpoint: endpointUrl || null,
        });
      }
    }, [endpointUrl]);

    React.useEffect(() => {
      if (props.node.attrs.schemaUrl !== connectionUrl) {
        props.updateAttributes({
          schemaUrl: connectionUrl,
        })
      }
    }, [connectionUrl])

    // GraphQL Introspection Query
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

    // Parse introspection result to schema structure
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
          if (typeRef.kind === 'NON_NULL') {
            return parseTypeRef(typeRef.ofType) + '!';
          }
          if (typeRef.kind === 'LIST') {
            return '[' + parseTypeRef(typeRef.ofType) + ']';
          }
          return typeRef.name || 'String';
        };

        const parseField = (field: any): GraphQLField => {
          return {
            name: field.name,
            type: parseTypeRef(field.type),
            args: field.args?.map((arg: any) => ({
              name: arg.name,
              type: parseTypeRef(arg.type)
            })) || []
          };
        };

        const queries = queryType?.fields?.map(parseField) || [];
        const mutations = mutationType?.fields?.map(parseField) || [];
        const subscriptions = subscriptionType?.fields?.map(parseField) || [];

        const parsedTypes: GraphQLType[] = types
          .filter((t: any) => !t.name.startsWith('__'))
          .map((t: any) => ({
            name: t.name,
            fields: t.fields?.map(parseField) || []
          }));

        return {
          queries,
          mutations,
          subscriptions,
          types: parsedTypes
        };
      } catch (error) {
        return null;
      }
    };

    // Fetch schema from URL using Electron IPC
    const handleConnect = async () => {
      if (!connectionUrl || connectionUrl === 'http://') {
        setConnectionError('Please enter a valid URL');
        return;
      }

      setIsConnecting(true);
      setConnectionError('');
      try {
        // Prepare request state for IPC
        const requestState = {
          method: 'POST',
          url: connectionUrl,
          headers: [
            { key: 'Content-Type', value: 'application/json', enabled: true }
          ],
          body: JSON.stringify({ query: introspectionQuery }),
          queryParams: [],
          pathParams: [],
        };

        // Use Electron IPC to send request
        const response = await (window as any).electron?.request?.sendSecure(requestState);

        if (!response || !response.status || response.status < 200 || response.status >= 300) {
          const statusText = response?.statusText || 'Unknown error';
          const status = response?.status || 'N/A';
          throw new Error(`HTTP ${status}: ${statusText}`);
        }

        // Parse response body
        let data;
        if (response.body) {
          const buffer = Buffer.from(response.body);
          const bodyText = buffer.toString();
          try {
            data = JSON.parse(bodyText);
          } catch (e) {
            throw new Error('Invalid JSON response. Make sure the URL points to a GraphQL endpoint.');
          }
        } else {
          throw new Error('No response body received from the server.');
        }

        // Check for GraphQL errors in response
        if (data.errors && data.errors.length > 0) {
          throw new Error(`GraphQL Error: ${data.errors[0].message}`);
        }

        const parsedSchema = parseIntrospectionToSchema(data);

        if (parsedSchema) {
          setSchema(parsedSchema);
          // Auto-populate endpoint URL if not already set
          if (!endpointUrl) {
            setEndpointUrl(connectionUrl);
          }
          props.updateAttributes({
            schemaUrl: connectionUrl,
            schemaFileName: null,
            schemaFilePath: null,
          });
          setShowConnectionInput(false);
          setConnectionError('');
        } else {
          setConnectionError('Failed to parse schema. The response may not be a valid GraphQL introspection result.');
        }
      } catch (error: any) {
        console.error('Error fetching schema:', error);
        setConnectionError(error.message || 'Failed to connect to GraphQL endpoint');
      } finally {
        setIsConnecting(false);
      }
    };

    // Get available operations from current query (use editorQuery for real-time updates)
    const availableOperations = React.useMemo(() => {
      return extractOperations(editorQuery || props.node.attrs.body || '');
    }, [editorQuery, props.node.attrs.body]);

    // Auto-detect operation type
    React.useEffect(() => {
      if (availableOperations.length > 0) {
        // Auto-detect and set operation type based on the first operation
        const firstOp = availableOperations[0];
        if (firstOp && firstOp.type !== props.node.attrs.operationType) {
          props.updateAttributes({ operationType: firstOp.type });
        }
      }
    }, [availableOperations]);

    // Save editor content to props when switching to viewer mode or when content changes
    React.useEffect(() => {
      if (mode === 'viewer' && editorQuery !== props.node.attrs.body) {
        props.updateAttributes({ body: editorQuery });
      }
    }, [mode]);

    // Parse and update checkboxes whenever editor query changes
    React.useEffect(() => {
      if (!schema || !editorQuery) return;

      // Get all schema operations (support all types in one document)
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
      // Priority 1: Load from file if both file and URL are provided
      if (props.node.attrs.schemaFilePath && props.node.attrs.schemaFileName && props.node.attrs.schemaUrl) {
        // Clear URL if file is present (file has priority)
        props.updateAttributes({ schemaUrl: null });
        if (!schema) {
          loadSchemaFile();
        }
        return;
      }

      // Priority 2: Load from file if only file is provided
      if (props.node.attrs.schemaFilePath && props.node.attrs.schemaFileName && !schema) {
        loadSchemaFile();
        return;
      }

      // Priority 3: Load from URL if only URL is provided
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
        if (parsed) {
          setSchema(parsed);
        }
      } catch (error) {
        // Error loading schema file
      }
    };

    const loadSchemaFromUrl = async () => {
      const url = props.node.attrs.schemaUrl;
      if (!url) return;

      try {
        const requestState = {
          method: 'POST',
          url: url,
          headers: [
            { key: 'Content-Type', value: 'application/json', enabled: true }
          ],
          body: JSON.stringify({ query: introspectionQuery }),
          queryParams: [],
          pathParams: [],
        };

        const response = await (window as any).electron?.request?.sendSecure(requestState);

        if (!response || !response.status || response.status < 200 || response.status >= 300) {
          setShowConnectionInput(true);
          setConnectionError('Failed to load schema from URL : ' + response?.statusText);
          console.error('Failed to load schema from URL:', response?.statusText);
          return;
        }

        let data;
        if (response.body) {
          const buffer = Buffer.from(response.body);
          const bodyText = buffer.toString();
          try {
            data = JSON.parse(bodyText);
          } catch (e) {
            console.error('Failed to parse schema response');
            return;
          }
        } else {
          return;
        }

        const parsedSchema = parseIntrospectionToSchema(data);
        if (parsedSchema) {
          setSchema(parsedSchema);
        }
      } catch (error) {
        console.error('Error loading schema from URL:', error);
      }
    };

    // Handle editor content changes - update local state and parse for viewer
    const handleEditorChange = (newContent: string) => {
      setEditorQuery(newContent);

      // Update props immediately without any conversion
      props.updateAttributes({ body: newContent });

      // Parse and update checkboxes based on editor content
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

            // Parse operation-level arguments
            const opArgPattern = new RegExp(
              `${op.type}\\s+${opName}\\s*\\(([^)]*)\\)`,
              's'
            );
            const opArgMatch = newContent.match(opArgPattern);
            if (opArgMatch && opArgMatch[1]) {
              const argNames = new Set<string>();
              const argRegex = /\$(\w+)\s*:/g;
              let match;
              while ((match = argRegex.exec(opArgMatch[1])) !== null) {
                argNames.add(match[1]);
              }
              newOperationArgSelections[opName] = argNames;
            }

            // Parse field-level arguments
            fields.forEach(fieldName => {
              const fieldPattern = new RegExp(
                `${fieldName}\\s*\\(([^)]*)\\)`,
                's'
              );
              const fieldMatch = newContent.match(fieldPattern);
              if (fieldMatch && fieldMatch[1]) {
                const argNames = new Set<string>();
                const argRegex = /(\w+)\s*:/g;
                let match;
                while ((match = argRegex.exec(fieldMatch[1])) !== null) {
                  argNames.add(match[1]);
                }

                if (!newFieldArgSelections[opName]) {
                  newFieldArgSelections[opName] = {};
                }
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

        if (!filePath) {
          alert('Could not get file path');
          return;
        }

        const electronApi = (window as any).electron;
        if (!electronApi?.files?.read) {
          alert('File API not available');
          return;
        }

        const content = await electronApi.files.read(filePath);
        const parsed = parseGraphQLSchema(content);

        props.updateAttributes({
          schemaFileName: file.name,
          schemaFilePath: filePath,
          schemaUrl: null, // Clear URL when file is uploaded
        });

        setSchema(parsed);
      } catch (error) {
        alert('Failed to read schema file');
      }
    };

    const handleOperationToggle = (operationName: string) => {
      setExpandedOperations(prev => {
        const newSet = new Set(prev);
        if (newSet.has(operationName)) {
          // Collapse if already expanded
          newSet.delete(operationName);
        } else {
          // Expanding: first determine which operation type this belongs to
          const isQuery = schema?.queries?.some(q => q.name === operationName);
          const isMutation = schema?.mutations?.some(m => m.name === operationName);
          const isSubscription = schema?.subscriptions?.some(s => s.name === operationName);

          // Clear all expanded operations (from all types)
          newSet.clear();

          // Switch to the appropriate tab based on operation type
          if (isQuery) {
            setActiveTab('query');
          } else if (isMutation) {
            setActiveTab('mutation');
          } else if (isSubscription) {
            setActiveTab('subscription');
          }

          // Expand the clicked operation
          newSet.add(operationName);

          // Initialize field selections for this operation if not exists
          if (!operationFieldSelections[operationName]) {
            setOperationFieldSelections(prevSelections => ({
              ...prevSelections,
              [operationName]: new Set()
            }));

            // Parse existing query if any
            const currentOp = [...(schema?.queries || []), ...(schema?.mutations || []), ...(schema?.subscriptions || [])]
              .find(op => op.name === operationName);
            if (currentOp && props.node.attrs.body) {
              parseQueryForOperation(currentOp, operationName);
            }
          }
        }
        return newSet;
      });
    };

    const handleOperationSelect = (operationName: string, checked: boolean) => {
      setSelectedOperations(prev => {
        const newSet = new Set(prev);

        if (checked) {
          // Determine the operation type of the selected operation
          const isQuery = schema?.queries?.some(q => q.name === operationName);
          const isMutation = schema?.mutations?.some(m => m.name === operationName);
          const isSubscription = schema?.subscriptions?.some(s => s.name === operationName);

          // Check if there are already selected operations from a different type
          let hasConflictingType = false;
          const operationsToRemove: string[] = [];

          prev.forEach(selectedOp => {
            const selectedIsQuery = schema?.queries?.some(q => q.name === selectedOp);
            const selectedIsMutation = schema?.mutations?.some(m => m.name === selectedOp);
            const selectedIsSubscription = schema?.subscriptions?.some(s => s.name === selectedOp);

            // If selected operation is different type than current, mark for removal
            if ((isQuery && (selectedIsMutation || selectedIsSubscription)) ||
              (isMutation && (selectedIsQuery || selectedIsSubscription)) ||
              (isSubscription && (selectedIsQuery || selectedIsMutation))) {
              hasConflictingType = true;
              operationsToRemove.push(selectedOp);
            }

            // For subscriptions: only allow one subscription at a time
            if (isSubscription && selectedIsSubscription && selectedOp !== operationName) {
              operationsToRemove.push(selectedOp);
            }
          });

          // Clear conflicting operations if any
          if (hasConflictingType || operationsToRemove.length > 0) {
            operationsToRemove.forEach(opName => {
              newSet.delete(opName);

              // Clear all related state for removed operations
              setOperationFieldSelections(prevSelections => {
                const newSelections = { ...prevSelections };
                delete newSelections[opName];
                return newSelections;
              });

              setOperationArgSelections(prevSelections => {
                const newSelections = { ...prevSelections };
                delete newSelections[opName];
                return newSelections;
              });

              setFieldArgSelections(prevSelections => {
                const newSelections = { ...prevSelections };
                delete newSelections[opName];
                return newSelections;
              });

              setNestedFieldSelections(prevSelections => {
                const newSelections = { ...prevSelections };
                delete newSelections[opName];
                return newSelections;
              });
            });

            // Clear the query editor and regenerate based on new operation
            setEditorQuery('');
            props.updateAttributes({ body: '' });
          }

          newSet.add(operationName);
        } else {
          newSet.delete(operationName);

          // Clear all related state when operation is deselected
          // Remove field selections
          setOperationFieldSelections(prevSelections => {
            const newSelections = { ...prevSelections };
            delete newSelections[operationName];
            return newSelections;
          });

          // Remove operation arguments
          setOperationArgSelections(prevSelections => {
            const newSelections = { ...prevSelections };
            delete newSelections[operationName];
            return newSelections;
          });

          // Remove field arguments
          setFieldArgSelections(prevSelections => {
            const newSelections = { ...prevSelections };
            delete newSelections[operationName];
            return newSelections;
          });

          // Remove nested field selections
          setNestedFieldSelections(prevSelections => {
            const newSelections = { ...prevSelections };
            delete newSelections[operationName];
            return newSelections;
          });
        }
        return newSet;
      });
    };

    const handleOperationArgToggle = (operationName: string, argName: string) => {
      setOperationArgSelections(prev => {
        const newSelections = { ...prev };
        if (!newSelections[operationName]) {
          newSelections[operationName] = new Set();
        } else {
          newSelections[operationName] = new Set(newSelections[operationName]);
        }

        const args = newSelections[operationName];
        if (args.has(argName)) {
          args.delete(argName);
        } else {
          args.add(argName);
        }

        return newSelections;
      });
    };

    const parseQueryForOperation = (operation: GraphQLField, operationName: string) => {
      const body = props.node.attrs.body;
      if (!body) return;

      // Check if operation is in the query
      const isOperationPresent = isOperationInQuery(body, operation.name);

      if (isOperationPresent) {
        setSelectedOperations(prev => new Set(prev).add(operationName));
      }

      // Parse fields from query body
      const parsedFields = parseQueryFields(body, operation.name);

      setOperationFieldSelections(prev => ({
        ...prev,
        [operationName]: parsedFields
      }));
    };

    const handleFieldToggle = (operationName: string, fieldName: string) => {
      setOperationFieldSelections(prev => {
        const current = prev[operationName] || new Set();
        const newFields = new Set(current);
        if (newFields.has(fieldName)) {
          newFields.delete(fieldName);

          // When unchecking a field, remove all its nested selections and field arguments
          setNestedFieldSelections(prevNested => {
            const newNested = { ...prevNested };
            if (newNested[operationName]) {
              newNested[operationName] = { ...newNested[operationName] };
              // Remove all nested selections that start with this field
              Object.keys(newNested[operationName]).forEach(path => {
                if (path === fieldName || path.startsWith(`${fieldName}.`)) {
                  delete newNested[operationName][path];
                }
              });
            }
            return newNested;
          });

          // Remove field arguments for this field using the exact field path
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
        return {
          ...prev,
          [operationName]: newFields
        };
      });
    };

    const handleFieldArgToggle = (operationName: string, fieldPath: string, argName: string) => {
      setFieldArgSelections(prev => {
        const newSelections = { ...prev };
        if (!newSelections[operationName]) {
          newSelections[operationName] = {};
        }
        if (!newSelections[operationName][fieldPath]) {
          newSelections[operationName][fieldPath] = new Set();
        }
        const args = new Set(newSelections[operationName][fieldPath]);
        if (args.has(argName)) {
          args.delete(argName);
        } else {
          args.add(argName);
        }
        newSelections[operationName] = {
          ...newSelections[operationName],
          [fieldPath]: args
        };
        return newSelections;
      });
    };

    const handleNestedFieldToggle = (operationName: string, fieldPath: string, subfieldName: string) => {
      setNestedFieldSelections(prev => {
        const newSelections = { ...prev };

        // Ensure operation exists
        if (!newSelections[operationName]) {
          newSelections[operationName] = {};
        } else {
          // Clone the operation's nested fields object
          newSelections[operationName] = { ...newSelections[operationName] };
        }

        // Ensure fieldPath exists and clone the Set
        if (!newSelections[operationName][fieldPath]) {
          newSelections[operationName][fieldPath] = new Set();
        } else {
          newSelections[operationName][fieldPath] = new Set(newSelections[operationName][fieldPath]);
        }

        const subfields = newSelections[operationName][fieldPath];
        const isRemoving = subfields.has(subfieldName);

        if (isRemoving) {
          subfields.delete(subfieldName);

          // When unchecking a nested field, remove all its deeper nested selections
          const subfieldPath = `${fieldPath}.${subfieldName}`;
          Object.keys(newSelections[operationName]).forEach(path => {
            if (path === subfieldPath || path.startsWith(`${subfieldPath}.`)) {
              delete newSelections[operationName][path];
            }
          });

          // Remove field arguments for this nested field using the full path
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

          // Auto-select parent field when nested field is selected
          const pathParts = fieldPath.split('.');
          const topLevelField = pathParts[0];

          setOperationFieldSelections(prevFields => {
            const newFields = { ...prevFields };
            if (!newFields[operationName]) {
              newFields[operationName] = new Set();
            } else {
              newFields[operationName] = new Set(newFields[operationName]);
            }
            newFields[operationName].add(topLevelField);
            return newFields;
          });

          // Also ensure all intermediate parent fields are selected
          for (let i = 1; i < pathParts.length; i++) {
            const parentPath = pathParts.slice(0, i).join('.');
            const currentField = pathParts[i];

            if (!newSelections[operationName][parentPath]) {
              newSelections[operationName][parentPath] = new Set();
            }
            newSelections[operationName][parentPath].add(currentField);
          }
        }

        return newSelections;
      });
    };

    // Recursive component to render field with its subfields
    const renderField = (
      operationName: string,
      field: GraphQLField,
      fieldPath: string,
      depth: number = 0,
      isSelected: boolean,
      onToggle: () => void
    ): JSX.Element => {
      if (!schema) return <></>;

      // Use the isSelected value passed from parent - it's computed with fresh state
      // No need to re-compute here as it can cause stale closure issues

      // Use full path for field arg selections to avoid conflicts between operations
      const fieldArgKey = `${operationName}.${fieldPath}`;
      const fieldArgSelection = fieldArgSelections[operationName]?.[fieldPath] || new Set();
      const returnTypeName = field.type.replace(/[\[\]!]/g, '');
      const returnType = schema.types.find(t => t.name.toLowerCase() === returnTypeName.toLowerCase());
      const hasSubfields = returnType && returnType.fields && returnType.fields.length > 0;

      // Get nested fields for this field's path using exact match
      const currentLevelNestedFields = nestedFieldSelections[operationName]?.[fieldPath] || new Set();

      return (
        <div key={`${operationName}.${fieldPath}`} className="space-y-1">
          <label
            className="flex items-center gap-2 text-xs cursor-pointer hover:bg-active p-1.5 rounded transition-colors"
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggle}
              className="cursor-pointer"
            />
            <span className="font-mono text-text">{field.name}</span>
            <span className="text-comment">: {field.type}</span>
            {hasSubfields && <span className="text-comment text-[10px]">(has fields)</span>}
          </label>

          {/* Field arguments */}
          {field.args && field.args.length > 0 && isSelected && (
            <div className="ml-8 pl-2 border-l border-border space-y-1" style={{ marginLeft: `${depth * 1.5 + 2}rem` }}>
              {field.args.map((arg) => (
                <label
                  key={arg.name}
                  className="flex items-center gap-2 text-xs cursor-pointer hover:bg-active p-1 rounded transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={fieldArgSelection.has(arg.name)}
                    onChange={() => handleFieldArgToggle(operationName, fieldPath, arg.name)}
                    className="cursor-pointer"
                  />
                  <span className="font-mono text-comment">{arg.name}</span>
                  <span className="text-comment">: {arg.type}</span>
                </label>
              ))}
            </div>
          )}

          {/* Subfields */}
          {hasSubfields && isSelected && returnType && (
            <div className="ml-4 pl-4 space-y-1">
              {returnType.fields.map((subfield) => {
                const subfieldPath = `${fieldPath}.${subfield.name}`;
                const isSubfieldSelected = currentLevelNestedFields.has(subfield.name);

                return renderField(
                  operationName,
                  subfield,
                  subfieldPath,
                  depth + 1,
                  isSubfieldSelected,
                  () => handleNestedFieldToggle(operationName, fieldPath, subfield.name)
                );
              })}
            </div>
          )}
        </div>
      );
    };

    // Auto-generate query when selections change (only in viewer mode)
    React.useEffect(() => {
      if (!schema || mode !== 'viewer') return;

      // Don't generate if no operations selected
      if (selectedOperations.size === 0) {
        return;
      }

      const result = generateQuery({
        schema,
        selectedOperations,
        operationFieldSelections,
        fieldArgSelections,
        operationArgSelections,
        nestedFieldSelections,
        activeTab
      });

      if (result.query && result.query !== editorQuery) {
        // Only update if the generated query is different from current
        // Update both editorQuery and props immediately in viewer mode
        // Don't convert to Voiden format - keep raw newlines for display
        setEditorQuery(result.query);
        props.updateAttributes({
          body: result.query, // Changed: removed convertToVoidenFormat
          operationType: result.operationType
        });
      }
    }, [selectedOperations, operationFieldSelections, fieldArgSelections, operationArgSelections, nestedFieldSelections, schema, activeTab, mode]);

    // Function to sync variables with query
    const syncVariables = React.useCallback(() => {
      const firstOperation = availableOperations[0]?.name;
      if (!firstOperation || !props.node.attrs.body) return;

      // Find the variables node in the document
      const doc = props.editor.state.doc;
      let variablesNodePos: number | null = null;
      let variablesNode: any = null;

      doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'gqlvariables') {
          variablesNode = node;
          variablesNodePos = pos;
          return false;
        }
      });

      if (variablesNode && variablesNodePos !== null) {
        const selectedArgs = operationArgSelections[firstOperation] || new Set();
        const currentVariables = variablesNode.attrs.body;
        const newVariables = generateVariablesFromQuery(
          props.node.attrs.body,
          currentVariables,
          firstOperation,
          selectedArgs
        );

        if (newVariables !== currentVariables) {
          const tr = props.editor.state.tr;
          tr.setNodeMarkup(variablesNodePos, null, {
            ...variablesNode.attrs,
            body: newVariables
          });
          props.editor.view.dispatch(tr);
        }
      }
    }, [props.node.attrs.body, availableOperations, operationArgSelections, props.editor]);

    // Sync on query/operation changes
    React.useEffect(() => {
      syncVariables();
    }, [syncVariables]);

    // Listen for editor updates to detect new variables nodes
    React.useEffect(() => {
      const handleUpdate = () => {
        syncVariables();
      };

      props.editor.on('update', handleUpdate);
      return () => {
        props.editor.off('update', handleUpdate);
      };
    }, [props.editor, syncVariables]);

    const hasSchema = (props.node.attrs.schemaFileName || props.node.attrs.schemaUrl) && schema;
    const currentOperationType = props.node.attrs.operationType || 'query';
    const isEditable = props.editor.isEditable;

    return (
      <NodeViewWrapper>
        <div className="my-2 overflow-hidden">
          <RequestBlockHeader
            title={`GRAPHQL-Query`}
            withBorder={false}
            editor={props.editor}
          />

          {/* Endpoint URL */}
          <div className="bg-panel border-t border-b border-border px-3 py-1.5 flex items-center gap-2">
            <span className="text-xs text-comment font-medium uppercase tracking-wide shrink-0">POST</span>
            <input
              type="text"
              value={endpointUrl}
              onChange={(e) => isEditable && setEndpointUrl(e.target.value)}
              readOnly={!isEditable}
              placeholder="https://api.example.com/graphql"
              className={`flex-1 px-2 py-1 bg-editor border border-border rounded text-sm text-text placeholder-comment focus:outline-none transition-colors font-mono ${isEditable ? 'focus:border-accent' : 'cursor-default'}`}
            />
            {sendRequest && (
              <button
                className="flex items-center justify-center w-7 h-7 rounded-md border hover:bg-hover text-status-success transition-colors shrink-0"
                onClick={(e) => {
                  sendRequest.refetchFromElement(e.currentTarget as HTMLElement);
                }}
                style={{ borderColor: 'var(--ui-line)', cursor: 'pointer', userSelect: 'none' }}
                title="Send request"
              >
                <Play size={12} />
              </button>
            )}
          </div>

          {/* Schema file selector — only show controls when editable */}
          {!props.node.attrs.schemaFileName && !props.node.attrs.schemaUrl && !showConnectionInput ? (
            isEditable ? (
              <div className="bg-panel border-t border-b border-border px-3 py-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".graphql,.gql"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="graphql-schema-input"
                />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="text-sm text-accent hover:text-accent/80 transition-colors cursor-pointer flex items-center gap-1.5 group"
                    onClick={() => {
                      setShowConnectionInput(false);
                      fileInputRef.current?.click()
                    }}
                    title="Import schema"
                  >
                    <FileDown className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    className="text-sm text-accent hover:text-accent/80 transition-colors cursor-pointer flex items-center gap-1.5 group"
                    onClick={() => setShowConnectionInput(!showConnectionInput)}
                    title="Connect to GraphQL endpoint"
                  >
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
                  <button
                    className="text-xs px-2 py-1 text-red-400 hover:text-text hover:bg-active rounded transition-colors"
                    onClick={() => {
                      props.updateAttributes({
                        schemaFileName: null,
                        schemaFilePath: null,
                        schemaUrl: null,
                      });
                      setSchema(null);
                      setShowConnectionInput(false);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  >
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
                <input
                  type="text"
                  value={connectionUrl}
                  onChange={(e) => {
                    setConnectionUrl(e.target.value);
                    if (connectionError) setConnectionError('');
                  }}
                  placeholder="http://"
                  className="flex-1 px-3 py-1.5 bg-editor border border-border rounded text-sm text-text placeholder-comment focus:outline-none focus:border-accent transition-colors font-mono"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
                      handleConnect();
                    }
                  }}
                />
                <button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="px-3 py-1.5 bg-accent hover:bg-accent/80 disabled:bg-accent/50 text-white rounded text-sm flex items-center gap-1.5 transition-colors"
                  title="Connect to endpoint"
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <Link className="w-4 h-4" />
                      <span>Connect</span>
                    </>
                  )}
                </button>
              </div>
              {connectionError && (
                <div className="p-2 text-xs italic text-red-400 flex items-center gap-2">
                  <CircleX size={14} /> {connectionError}
                </div>
              )}
            </div>
          )}

          {/* Mode toggle and operation selector */}
          <div className="bg-panel border-b border-border px-3 py-2 flex items-center gap-2">
            {/* Mode toggle - only show if schema is loaded and editable */}
            {hasSchema && isEditable && (
              <>
                <button
                  onClick={() => setMode('editor')}
                  className={`p-1.5 rounded transition-colors ${mode === 'editor'
                    ? 'bg-accent/30 text-text'
                    : 'text-comment hover:text-text hover:bg-active'
                    }`}
                  title="Editor mode"
                >
                  <Pen className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setMode('viewer')}
                  className={`p-1.5 rounded transition-colors ${mode === 'viewer'
                    ? 'bg-accent/30 text-text'
                    : 'text-comment hover:text-text hover:bg-active'
                    }`}
                  title="Viewer mode"
                >
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
                  node: {
                    ...props.node,
                    attrs: {
                      ...props.node.attrs,
                      body: editorQuery
                    }
                  },
                  updateAttributes: (attrs: any) => {
                    if (attrs.body !== undefined) {
                      setEditorQuery(attrs.body);
                      props.updateAttributes({ body: attrs.body });
                    }
                  }
                }}
                lang="graphql"
                showReplace={false}
                autofocus={isEditable && !props.node.attrs.importedFrom}
                readOnly={!isEditable || !!props.node.attrs.importedFrom}
                onChange={handleEditorChange}
              />
            </div>
          ) : (
            <div className="bg-editor border border-border">
              {schema && (
                <div>
                  {/* Tabs for Query/Mutation/Subscription */}
                  <div className="flex border-b border-border">
                    {schema.queries.length > 0 && (
                      <button
                        onClick={() => {
                          setActiveTab('query');
                          setExpandedOperations(new Set());
                        }}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'query'
                          ? 'bg-active text-accent border-b-2 border-accent'
                          : 'text-comment hover:text-text hover:bg-panel'
                          }`}
                      >
                        Query ({schema.queries.length})
                      </button>
                    )}
                    {schema.mutations.length > 0 && (
                      <button
                        onClick={() => {
                          setActiveTab('mutation');
                          setExpandedOperations(new Set());
                        }}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'mutation'
                          ? 'bg-active text-accent border-b-2 border-accent'
                          : 'text-comment hover:text-text hover:bg-panel'
                          }`}
                      >
                        Mutation ({schema.mutations.length})
                      </button>
                    )}
                    {schema.subscriptions.length > 0 && (
                      <button
                        onClick={() => {
                          setActiveTab('subscription');
                          setExpandedOperations(new Set());
                        }}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'subscription'
                          ? 'bg-active text-accent border-b-2 border-accent'
                          : 'text-comment hover:text-text hover:bg-panel'
                          }`}
                      >
                        Subscription ({schema.subscriptions.length})
                      </button>
                    )}
                  </div>

                  {/* Operations list with collapsible sections */}
                  <div className="p-4 max-h-96 overflow-y-auto">
                    <div className="space-y-2">
                      {activeTab === 'query' && schema.queries.map((query) => {
                        const isExpanded = expandedOperations.has(query.name);
                        const isSelected = selectedOperations.has(query.name);
                        const fields = operationFieldSelections[query.name] || new Set();
                        const returnTypeName = query.type.replace(/[\[\]!]/g, '');
                        const returnType = schema.types.find(t => t.name === returnTypeName);
                        const queryName = query.name; // Capture in closure

                        return (
                          <div
                            key={query.name}
                            ref={(el) => {
                              if (isExpanded && el) {
                                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                              }
                            }}
                            className="border border-border rounded overflow-hidden"
                          >
                            <div className="flex items-center bg-panel hover:bg-active transition-colors cursor-pointer">
                              <label className="flex items-center px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => handleOperationSelect(query.name, e.target.checked)}
                                  className="cursor-pointer"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </label>
                              <button
                                onClick={() => handleOperationToggle(query.name)}
                                className="flex-1 text-left px-3 py-2 flex items-center justify-between"
                              >
                                <div className="flex-1">
                                  <div className="font-mono text-sm text-text">{query.name}</div>
                                  <div className="text-xs text-comment mt-0.5">Returns: {query.type}</div>
                                </div>
                                <div className="text-comment">{isExpanded ? '▼' : '▶'}</div>
                              </button>
                            </div>

                            {isExpanded && (
                              <div className="bg-editor p-3 border-t border-border">
                                {/* Arguments - selectable with checkboxes */}
                                {query.args && query.args.length > 0 && (
                                  <div className="mb-3">
                                    <h5 className="text-xs font-semibold text-text mb-2">Arguments:</h5>
                                    <div className="space-y-1.5 pl-2">
                                      {query.args.map((arg) => {
                                        const operationArgSelection = operationArgSelections[query.name] || new Set();
                                        return (
                                          <label
                                            key={arg.name}
                                            className="flex items-center gap-2 text-xs cursor-pointer hover:bg-active p-1 rounded transition-colors"
                                          >
                                            <input
                                              type="checkbox"
                                              checked={operationArgSelection.has(arg.name)}
                                              onChange={() => handleOperationArgToggle(query.name, arg.name)}
                                              className="cursor-pointer"
                                            />
                                            <span className="font-mono text-text">{arg.name}</span>
                                            <span className="text-comment">: {arg.type}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* Fields */}
                                <div>
                                  <h5 className="text-xs font-semibold text-text mb-2">Fields to return:</h5>
                                  {returnType && returnType.fields && returnType.fields.length > 0 ? (
                                    <div className="space-y-1.5">
                                      {returnType.fields.map((field) => (
                                        <React.Fragment key={`${queryName}-${field.name}`}>
                                          {renderField(
                                            queryName,
                                            field,
                                            field.name,
                                            0,
                                            fields.has(field.name),
                                            () => handleFieldToggle(queryName, field.name)
                                          )}
                                        </React.Fragment>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-comment">Scalar type or no fields available</div>
                                  )}
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
                        const mutationName = mutation.name; // Capture in closure

                        return (
                          <div
                            key={mutation.name}
                            ref={(el) => {
                              if (isExpanded && el) {
                                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                              }
                            }}
                            className="border border-border rounded overflow-hidden"
                          >
                            <div className="flex items-center bg-panel hover:bg-active transition-colors cursor-pointer">
                              <label className="flex items-center px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => handleOperationSelect(mutation.name, e.target.checked)}
                                  className="cursor-pointer"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </label>
                              <button
                                onClick={() => handleOperationToggle(mutation.name)}
                                className="flex-1 text-left px-3 py-2 flex items-center justify-between"
                              >
                                <div className="flex-1">
                                  <div className="font-mono text-sm text-text">{mutation.name}</div>
                                  <div className="text-xs text-comment mt-0.5">Returns: {mutation.type}</div>
                                </div>
                                <div className="text-comment">{isExpanded ? '▼' : '▶'}</div>
                              </button>
                            </div>

                            {isExpanded && (
                              <div className="bg-editor p-3 border-t border-border">
                                {/* Arguments - selectable with checkboxes */}
                                {mutation.args && mutation.args.length > 0 && (
                                  <div className="mb-3">
                                    <h5 className="text-xs font-semibold text-text mb-2">Arguments:</h5>
                                    <div className="space-y-1.5 pl-2">
                                      {mutation.args.map((arg) => {
                                        const operationArgSelection = operationArgSelections[mutation.name] || new Set();
                                        return (
                                          <label
                                            key={arg.name}
                                            className="flex items-center gap-2 text-xs cursor-pointer hover:bg-active p-1 rounded transition-colors"
                                          >
                                            <input
                                              type="checkbox"
                                              checked={operationArgSelection.has(arg.name)}
                                              onChange={() => handleOperationArgToggle(mutation.name, arg.name)}
                                              className="cursor-pointer"
                                            />
                                            <span className="font-mono text-text">{arg.name}</span>
                                            <span className="text-comment">: {arg.type}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* Fields */}
                                <div>
                                  <h5 className="text-xs font-semibold text-text mb-2">Fields to return:</h5>
                                  {returnType && returnType.fields && returnType.fields.length > 0 ? (
                                    <div className="space-y-1.5">
                                      {returnType.fields.map((field) => (
                                        <React.Fragment key={`${mutationName}-${field.name}`}>
                                          {renderField(
                                            mutationName,
                                            field,
                                            field.name,
                                            0,
                                            fields.has(field.name),
                                            () => handleFieldToggle(mutationName, field.name)
                                          )}
                                        </React.Fragment>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-comment">Scalar type or no fields available</div>
                                  )}
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
                        const subscriptionName = subscription.name; // Capture in closure

                        return (
                          <div
                            key={subscription.name}
                            ref={(el) => {
                              if (isExpanded && el) {
                                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                              }
                            }}
                            className="border border-border rounded overflow-hidden"
                          >
                            <div className="flex items-center bg-panel hover:bg-active transition-colors cursor-pointer">
                              <label className="flex items-center px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => handleOperationSelect(subscription.name, e.target.checked)}
                                  className="cursor-pointer"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </label>
                              <button
                                onClick={() => handleOperationToggle(subscription.name)}
                                className="flex-1 text-left px-3 py-2 flex items-center justify-between"
                              >
                                <div className="flex-1">
                                  <div className="font-mono text-sm text-text">{subscription.name}</div>
                                  <div className="text-xs text-comment mt-0.5">Returns: {subscription.type}</div>
                                </div>
                                <div className="text-comment">{isExpanded ? '▼' : '▶'}</div>
                              </button>
                            </div>

                            {isExpanded && (
                              <div className="bg-editor p-3 border-t border-border">
                                {/* Arguments - selectable with checkboxes */}
                                {subscription.args && subscription.args.length > 0 && (
                                  <div className="mb-3">
                                    <h5 className="text-xs font-semibold text-text mb-2">Arguments:</h5>
                                    <div className="space-y-1.5 pl-2">
                                      {subscription.args.map((arg) => {
                                        const operationArgSelection = operationArgSelections[subscription.name] || new Set();
                                        return (
                                          <label
                                            key={arg.name}
                                            className="flex items-center gap-2 text-xs cursor-pointer hover:bg-active p-1 rounded transition-colors"
                                          >
                                            <input
                                              type="checkbox"
                                              checked={operationArgSelection.has(arg.name)}
                                              onChange={() => handleOperationArgToggle(subscription.name, arg.name)}
                                              className="cursor-pointer"
                                            />
                                            <span className="font-mono text-text">{arg.name}</span>
                                            <span className="text-comment">: {arg.type}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* Fields */}
                                <div>
                                  <h5 className="text-xs font-semibold text-text mb-2">Fields to return:</h5>
                                  {returnType && returnType.fields && returnType.fields.length > 0 ? (
                                    <div className="space-y-1.5">
                                      {returnType.fields.map((field) => (
                                        <React.Fragment key={`${subscriptionName}-${field.name}`}>
                                          {renderField(
                                            subscriptionName,
                                            field,
                                            field.name,
                                            0,
                                            fields.has(field.name),
                                            () => handleFieldToggle(subscriptionName, field.name)
                                          )}
                                        </React.Fragment>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-comment">Scalar type or no fields available</div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {schema.queries.length === 0 && schema.mutations.length === 0 && schema.subscriptions.length === 0 && (
                    <div className="text-sm text-comment text-center py-4">
                      No operations found in schema
                    </div>
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
    name: "gqlquery",
    group: "block",
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
      return {
        body: {
          default: "",
        },
        operationType: {
          default: "", // auto-detect from body: query | mutation | subscription
        },
        endpoint: {
          default: null, // GraphQL endpoint URL for request execution
        },
        schemaFileName: {
          default: null,
        },
        schemaFilePath: {
          default: null,
        },
        schemaUrl: {
          default: null,
        },
        importedFrom: {
          default: undefined,
        },
      };
    },

    parseHTML() {
      return [
        {
          tag: "gqlquery",
          getAttrs: (element: any) => {
            const body = element.textContent;
            return { body };
          },
        },
      ];
    },

    renderHTML({ HTMLAttributes }) {
      return [
        "div",
        mergeAttributes(HTMLAttributes, { class: "gql-query-block" }),
      ];
    },

    addNodeView() {
      return ReactNodeViewRenderer(GraphQLQueryComponent);
    },

    addKeyboardShortcuts() {
      return {
        // Prevent backspace from deleting the node when focused
        Backspace: ({ editor }) => {
          const { selection } = editor.state;
          const node = selection.$from.node();

          // If we're at a gqlquery node, don't delete it with backspace
          if (node?.type.name === 'gqlquery') {
            return true; // handled, prevent default
          }

          return false; // not handled, allow default
        },
        // Prevent delete key from deleting the node
        Delete: ({ editor }) => {
          const { selection } = editor.state;
          const node = selection.$from.node();

          if (node?.type.name === 'gqlquery') {
            return true; // handled, prevent default
          }

          return false; // not handled, allow default
        },
      };
    },
  });
};

export const GraphQLQueryNode = createGraphQLQueryNode(
  ({ children }: any) => <div>{children}</div>,
  () => <div>CodeEditor not available</div>,
  () => <div>Header not available</div>
);
