interface CookieAttributes {
    value: string;

    [key: string]: string | boolean;
}

interface ParsedCookie {
    name: string;
    attributes: CookieAttributes;
}

/**
 * Parses a single cookie attribute (e.g., "Path=/api" or "Secure")
 */
function parseAttribute(attributeString: string): [string, string | boolean] {
    const equalIndex = attributeString.indexOf('=');

    if (equalIndex === -1) {
        // Boolean attribute (e.g., Secure, HttpOnly)
        return [attributeString, true];
    }

    // Key-value attribute (e.g., Path=/api, Max-Age=3600)
    const name = attributeString.substring(0, equalIndex).trim();
    const value = attributeString.substring(equalIndex + 1).trim();
    return [name, value];
}

/**
 * Parses a single Set-Cookie header value into name and attributes
 */
function parseSingleCookie(cookieString: string): ParsedCookie | null {
    const parts = cookieString.split(';').map(part => part.trim());

    if (parts.length === 0) {
        return null;
    }

    const firstEqualsIndex = parts[0].indexOf('=');
    const cookieName = parts[0].substring(0, firstEqualsIndex).trim();
    const cookieValue = parts[0].substring(firstEqualsIndex + 1).trim();

    if (!cookieName) {
        return null;
    }

    // Parse all attributes
    const attributes: CookieAttributes = {value: cookieValue};

    for (let i = 1; i < parts.length; i++) {
        const [attrName, attrValue] = parseAttribute(parts[i]);
        attributes[attrName] = attrValue;
    }

    return {name: cookieName, attributes};
}

/**
 * Parses Set-Cookie header(s) into a structured object
 * @param headers - Array of {key, value} header objects
 * @returns Object with cookie names as keys and cookie details as values
 *
 * If multiple Set-Cookie headers have the same cookie name, the last one wins
 * (matching browser behavior).
 *
 * @example
 * const headers = [
 *   { key: 'set-cookie', value: 'session=abc123; Path=/; Secure' }
 * ];
 * const cookies = parseCookies(headers);
 * // Returns: { session: { value: 'abc123', Path: '/', Secure: true } }
 */
export function parseCookies(headers: Array<{ key: string, value: string }>): Record<string, CookieAttributes> {
    if (!headers || !Array.isArray(headers)) {
        return {};
    }

    const cookies: Record<string, CookieAttributes> = {};

    headers.filter(header => header.key.toLowerCase() === 'set-cookie')
        .map(header => parseSingleCookie(header.value))
        .filter(cookie => cookie !== null)
        .forEach(cookie => cookies[cookie.name] = cookie.attributes);

    return cookies;
}
