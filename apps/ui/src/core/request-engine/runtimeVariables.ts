import { parseCookies } from '@voiden/core-extensions/shared/utils/cookieParser';

interface RuntimeVariable {
    key: string;
    value: string;
    enabled: boolean;
}

interface KeyValuePair {
    key: string;
    value: string;
}

interface RequestObject {
    method?: string;
    url?: string;
    headers?: KeyValuePair[];  // Array of {key, value}
    body?: any;
    query?: KeyValuePair[];     // Array of {key, value}
    params?: KeyValuePair[];    // Array of {key, value}
    path_params?: KeyValuePair[]; // Array of {key, value}
}

interface ResponseObject {
    status?: number;
    statusText?: string;
    headers?: KeyValuePair[];   // Array of {key, value}
    body?: any;
    time?: number;
    requestMeta?: RequestObject | undefined;
}

/**
 * Finds value from array of key-value pairs
 * @param arr - Array of {key, value} objects
 * @param key - The key to search for
 * @returns The value or undefined
 */
function findInKeyValueArray(arr: any[] | undefined, key: string): any {
    if (!arr || !Array.isArray(arr)) return undefined;
    // Find the first object that has the specified key
    const found = arr.find(item => item && typeof item === 'object' && key in item);
    return found ? found[key] : undefined;
}

function findInKeyValueInKeyValue(arr: any[] | undefined): any {
    if (!arr || !Array.isArray(arr)) return undefined;
    // Find the first object that has the specified key
    const found = arr.find(item => item && typeof item ==='object');
    return found ? found['value'] : undefined;
}

/**
 * Safely parses JSON string, returns original value if not valid JSON
 * Handles common JSON issues like trailing commas
 * @param value - The value to parse
 * @returns Parsed object or original value
 */
function safeJsonParse(value: any): any {
    if (typeof value !== 'string') return value;

    try {
        // First, try standard JSON parse
        return JSON.parse(value);
    } catch (error) {
        // If standard parse fails, try to fix common issues
        try {
            // Fix trailing commas in objects and arrays
            const fixedJson = value
                // Remove trailing commas in objects
                .replace(/,\s*}/g, '}')
                // Remove trailing commas in arrays  
                .replace(/,\s*]/g, ']')
                // Remove trailing commas before end of string
                .replace(/,\s*$/, '');

            return JSON.parse(fixedJson);
        } catch {
            // If still fails, return original value
            return value;
        }
    }
}

/**
 * Extracts value from an object using dot notation path
 * Handles both nested objects and key-value arrays, and stringified JSON
 * @param obj - The object to extract from
 * @param path - Dot notation path (e.g., "headers.Authorization" or "body.data.id")
 * @returns The extracted value or undefined
 */
function getValueByPath(obj: any, path: string): any {
    if (!obj || !path) return undefined;
    const keys = path.split(".");
    let current = obj;
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (current === null || current === undefined) {
            return undefined;
        }
        if(typeof current==='string'){
            current=safeJsonParse(current);
        }
        const arrayIndexMatch = key.match(/^(.+)\[(\d+)\]$/);
        if (arrayIndexMatch) {
            const arrayKey = arrayIndexMatch[1];
            const index = parseInt(arrayIndexMatch[2], 10);
            
            if (Array.isArray(current)) {
                current =  findInKeyValueArray(current, arrayKey);
            } else if (typeof current === 'object' && current !== null) {
                current = current[arrayKey];
            } else if(typeof current==='string'){
                const parsed=safeJsonParse(current);
                current=parsed;
            }else{
                return undefined;
            }
            if(typeof current==='string'){
                const parsed=safeJsonParse(current);
                current=parsed;
            }
            if (Array.isArray(current) && current[index] !== undefined) {
                current = current[index];
            }  else {
                return undefined;
            }
            continue;
        }
        // Check if current is an array of key-value pairs
        if (Array.isArray(current) && current.length > 0) {
            if ('key' in current[0] && 'value' in current[0] && key.toLowerCase() === 'set-cookie') {
                const cookies = parseCookies(current);

                if (i === keys.length - 1) {
                    return cookies;
                }

                current = cookies;
                continue;
            }

            let value = ""
            if( 'key' in current[0] && 'value' in current[0]){
                value = findInKeyValueInKeyValue(current);
            }else{
                value = findInKeyValueArray(current, key);
            }
            if (i === keys.length - 1) {
                return value;
            }
            if (value) {
                try {
                    current = JSON.parse(value);
                } catch {
                    current=value;
                }
            } else {
                return undefined;
            }
        } else if ( typeof current === 'object') {
            current = current[key];
        } else if (typeof current === 'string') {
            if (i < keys.length) {
                const parsed = safeJsonParse(current);
                if (typeof parsed === 'object' && parsed !== null) {
                    current = parsed[key];
                } else {
                    return undefined; // Can't navigate deeper in non-object
                }
            }
        } else {
            return undefined; // Can't navigate deeper in primitive values
        }
    }

    return current;
}

/**
 * Extracts all template expressions from a string
 * @param text - The text containing template expressions
 * @returns Array of template expressions found
 */
function extractTemplateExpressions(text: string): string[] {
    const regex = /{{\s*\$(\w+)\.([^}]+)\s*}}/g;
    const matches = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
        matches.push(match[0]); // Push the full match including {{}}
    }

    return matches;
}

/**
 * Parses a single template expression and extracts the source and path
 * @param template - Template string like "{{$req.headers.Authorization}}" or "{{$res.body.data.id}}"
 * @returns Object with source ("req" or "res") and path ("headers.Authorization")
 */
function parseTemplate(template: string): { source: "req" | "res"; path: string } | null {
    const match = template.match(/\{\{\s*\$(\w+)\.(.+?)\s*\}\}/);
    if (!match) return null;

    const source = match[1] as "req" | "res";
    const path = match[2].trim();

    return { source, path };
}

/**
 * Extracts value from template expression (returns actual value, not stringified)
 * @param text - The text containing ONE template expression
 * @param reqObject - Request object
 * @param resObject - Response object
 * @returns The extracted value (can be string, number, object, array, etc.)
 */
function extractTemplateValue(
    text: string,
    reqObject: RequestObject | undefined,
    resObject: ResponseObject
): any {
    const parsed = parseTemplate(text);
    if (!parsed) return undefined;

    const { source, path } = parsed;

    // Extract value from appropriate source
    let extractedValue: any;
    if (source === "req") {
        extractedValue = getValueByPath(reqObject, path);
    } else if (source === "res") {
        extractedValue = getValueByPath(resObject, path);
    }

    return extractedValue;
}

/**
 * Replaces all template expressions in a string with their actual values
 * @param text - The text containing template expressions
 * @param reqObject - Request object
 * @param resObject - Response object
 * @returns The text with all template expressions replaced
 */
function replaceTemplateExpressions(
    text: string,
    reqObject: RequestObject | undefined,
    resObject: ResponseObject
): string {
    const expressions = extractTemplateExpressions(text);
    let result = text;

    for (const expression of expressions) {
        const parsed = parseTemplate(expression);
        if (!parsed) continue;

        const { source, path } = parsed;

        // Extract value from appropriate source
        let extractedValue: any;
        if (source === "req") {
            extractedValue = getValueByPath(reqObject, path);
        } else if (source === "res") {
            extractedValue = getValueByPath(resObject, path);
        }

        // Replace the expression with the actual value
        if (extractedValue !== undefined && extractedValue !== null) {
            // Convert to string for replacement
            const stringValue = typeof extractedValue === 'object'
                ? JSON.stringify(extractedValue)
                : String(extractedValue);

            result = result.replace(expression, stringValue);
        } else {
            // If value not found, replace with empty string
            result = result.replace(expression, '');
        }
    }

    return result;
}


/**
 * Saves runtime variables to .voiden/.process.env.json with proper call type handling
 * @param resObject - Response object containing status, headers, body, etc.
 * @param captureArray - Array of runtime variable configurations
 * @param path - The file path to save variables
 * @param overwriteExisting - Whether to overwrite existing variables
 * @param callType - The type of call ('req' or 'res') to determine which expressions to process
 */
export async function saveRuntimeVariables(
    reqObject: RequestObject | undefined,
    resObject: ResponseObject,
    captureArray: RuntimeVariable[],
    path: string,
): Promise<void> {
    try {
        // Step 1: Read existing variables file
        let existingVariables: Record<string, any> = {};
        try {
            const fileContent = await window.electron?.files?.read(path + '/.voiden/.process.env.json');
            existingVariables = JSON.parse(fileContent || '{}');
        } catch (error: any) {
            // File doesn't exist or is invalid, start with empty object
            if (error.code !== "ENOENT") {
                console.warn("Error reading variables file, starting fresh:", error);
            }
        }

        // Step 2: Process capture array and extract values based on call type
        const newVariables: Record<string, any> = {};

        for (const capture of captureArray) {
            if (!capture.enabled) {
                continue; // Skip disabled captures
            }

            // Check if the value is a single template expression (e.g., "{{$res.body.data}}")
            // If so, extract the actual value (preserving objects/arrays)
            const trimmedValue = capture.value.trim();
            const isSingleTemplate = trimmedValue.match(/^\{\{\s*\$\w+\.[^}]+\s*\}\}$/);

            if (isSingleTemplate) {
                // Extract actual value (can be object, array, string, etc.)
                let extractedValue = extractTemplateValue(capture.value, reqObject, resObject);

                // If the extracted value is a string that looks like JSON, try to parse it
                // This handles cases where the response body was stored as a stringified JSON
                if (typeof extractedValue === 'string') {
                    const parsed = safeJsonParse(extractedValue);
                    // Only use parsed value if it's actually an object/array (not just a string)
                    if (typeof parsed === 'object' && parsed !== null) {
                        extractedValue = parsed;
                    }
                }

                if (extractedValue !== undefined && extractedValue !== null) {
                    newVariables[capture.key] = extractedValue;
                } else {
                    newVariables[capture.key] = null;
                }
            } else {
                // Multiple templates or mixed text - use string replacement
                const processedValue = replaceTemplateExpressions(capture.value, reqObject, resObject);
                if (processedValue && processedValue.trim() !== '' ) {
                    newVariables[capture.key] = processedValue;
                } else {
                    newVariables[capture.key] = "";
                }
            }
        }

        // Step 3: Merge with existing variables
        const mergedVariables = { ...existingVariables,...newVariables };
        // Step 4: Save back to file with pretty formatting
        await window.electron?.variables.writeVariables(JSON.stringify(mergedVariables, null, 2));
        await window.electron?.git?.updateGitignore(['.voiden','.voiden/.process.env.json'], path);
    } catch (error: any) {
        console.error("Error saving runtime variables:", error);
        throw error;
    }
}


/**
 * Replaces {{process.<variable>}} expressions with values from .voiden/.process.env.json
 * Handles both string replacement and JSON object preservation
 * @param text - The text containing process variable expressions
 * @param variables - The variables object from .voiden/.process.env.json
 * @returns The text with all process variable expressions replaced
 */
function replaceProcessVariables(text: string, variables: Record<string, any>, preserveObjects: boolean = false): any {
    if (!text || typeof text !== 'string') return text;

    const processRegex = /{{\s*process\.([^}]+)\s*}}/g;

    // Check if the entire text is a single process variable template
    const trimmedText = text.trim();
    const singleTemplateMatch = trimmedText.match(/^\{\{\s*process\.([^}]+)\s*\}\}$/);

    if (singleTemplateMatch && preserveObjects) {
        // Text is exactly one template expression - return the actual value (preserving type)
        const variablePath = singleTemplateMatch[1].trim();
        const value = getValueByPath(variables, variablePath);

        if (value !== undefined && value !== null) {
            return value; // Return actual value (can be object, array, string, etc.)
        } else {
            console.warn(`Process variable not found: ${variablePath}`);
            return null;
        }
    }

    // Multiple templates or mixed text - use string replacement
    return text.replace(processRegex, (match, variablePath) => {
        const trimmedPath = variablePath.trim();

        // Extract value from variables using dot notation
        const value = getValueByPath(variables, trimmedPath);

        if (value !== undefined && value !== null) {
            // Convert to string for replacement
            return typeof value === 'object' ? JSON.stringify(value) : String(value);
        } else {
            // If variable not found, keep the original expression or replace with empty string
            console.warn(`Process variable not found: ${trimmedPath}`);
            return ''; // or return match to keep the original expression
        }
    });
}

/**
 * Loads variables from .voiden/.process.env.json file
 * @param path - The directory path containing .voiden/.process.env.json
 * @returns The variables object or empty object if file doesn't exist
 */
async function loadProcessVariables(): Promise<Record<string, any>> {
    try {
        const state = await window.electron?.state?.get();
        const path = state?.activeDirectory || '';
        const fileContent = await window.electron?.files?.read(path + '/.voiden/.process.env.json');
        return fileContent ? JSON.parse(fileContent) : {};
    } catch (error: any) {
        if (error.code !== "ENOENT") {
            console.warn("Error reading process variables file:", error);
        }
        return {};
    }
}

/**
 * Replaces {{process.<variable>}} expressions in request state with values from .voiden/.process.env.json
 * Similar to preSendFakerHook but for process variables
 * @param requestState - The requestState
 */
export async function preSendProcessHook(requestState: any): Promise<any> {
    try {
        // Load process variables from file
        const processVariables = await loadProcessVariables();

        // If no variables loaded, skip processing
        if (Object.keys(processVariables).length === 0) {
            return requestState;
        }

        // Replace in URL
        if (requestState.url) {
            const originalUrl = requestState.url;
            requestState.url = replaceProcessVariables(requestState.url, processVariables);
        }

        // Replace in headers
        if (requestState.headers) {
            requestState.headers = requestState.headers.map((header: any) => ({
                ...header,
                value: replaceProcessVariables(header.value, processVariables),
            }));
        }

        // Replace in query parameters
        if (requestState.queryParams) {
            requestState.queryParams = requestState.queryParams.map((param: any) => ({
                ...param,
                value: param.value ? replaceProcessVariables(param.value, processVariables) : param.value,
            }));
        }

        // Replace in path parameters
        if (requestState.pathParams) {
            requestState.pathParams = requestState.pathParams.map((param: any) => ({
                ...param,
                value: param.value ? replaceProcessVariables(param.value, processVariables) : param.value,
            }));
        }

        // Replace in request body
        if (requestState.body) {
            const originalBody = requestState.body;

            // Handle both string and object bodies
            if (typeof requestState.body === 'string') {
                // Check if body is a single template - if so, preserve the actual type
                const trimmedBody = requestState.body.trim();
                const isSingleTemplate = trimmedBody.match(/^\{\{\s*process\.([^}]+)\s*\}\}$/);

                if (isSingleTemplate) {
                    // Single template - preserve object type
                    const replacedValue = replaceProcessVariables(requestState.body, processVariables, true);

                    // If it's an object/array, we're done
                    if (typeof replacedValue === 'object') {
                        requestState.body = replacedValue;
                    } else {
                        // If it's a primitive, convert to string
                        requestState.body = String(replacedValue);
                    }
                } else {
                    // Multiple templates or mixed text - use string replacement
                    requestState.body = replaceProcessVariables(requestState.body, processVariables);
                }
            } else if (typeof requestState.body === 'object') {
                // Body is already parsed as JSON, stringify -> replace -> parse back
                const bodyString = JSON.stringify(requestState.body);
                const replacedString = replaceProcessVariables(bodyString, processVariables);
                try {
                    requestState.body = JSON.parse(replacedString);
                } catch (e) {
                    // If parsing fails, keep as string
                    requestState.body = replacedString;
                }
            }
        }

        // Replace in body params (for multipart/form-data and url-encoded)
        if (requestState.bodyParams) {
            requestState.bodyParams = requestState.bodyParams.map((param: any) => {
                if (!param.value) return param;

                // Check if value is a single template
                const trimmedValue = param.value.trim();
                const isSingleTemplate = trimmedValue.match(/^\{\{\s*process\.([^}]+)\s*\}\}$/);

                if (isSingleTemplate) {
                    // Single template - get actual value
                    const replacedValue = replaceProcessVariables(param.value, processVariables, true);

                    // Convert to string for form params (they're always strings in HTTP)
                    return {
                        ...param,
                        value: typeof replacedValue === 'object' ? JSON.stringify(replacedValue) : String(replacedValue),
                    };
                } else {
                    // Multiple templates or mixed text
                    return {
                        ...param,
                        value: replaceProcessVariables(param.value, processVariables),
                    };
                }
            });
        }
        return requestState;
    } catch (error) {
        console.error('Error in preSendProcessHook:', error);
        return requestState
    }
}

/**
 * Utility function to replace process variables in any string
 * @param text - The text containing process variable expressions
 * @param workspacePath - The workspace path to load .voiden/.process.env.json from
 * @returns The text with process variables replaced
 */
export async function replaceProcessVariablesInText(text: string): Promise<string> {
    try {
        const processVariables = await loadProcessVariables();
        return replaceProcessVariables(text, processVariables);
    } catch (error) {
        console.error('Error replacing process variables in text:', error);
        return text;
    }
}
