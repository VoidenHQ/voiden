/**
 * Help content for REST API nodes
 */

import React from "react";

export const HttpHeadersHelp = () => (
  <div className="space-y-4">
    <section>
      <h3 className="font-semibold mb-2 text-text">HTTP Headers</h3>
      <p className="text-sm text-comment mb-3">
        HTTP headers allow you to pass additional information with your HTTP request.
        Headers are key-value pairs that provide metadata about the request.
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Common Headers</h4>
      <ul className="list-disc list-inside space-y-1 text-sm text-comment">
        <li><code className="bg-accent/10 px-1 rounded text-text">Content-Type</code> - Indicates the media type of the request body (e.g., application/json, text/xml)</li>
        <li><code className="bg-accent/10 px-1 rounded text-text">Authorization</code> - Contains credentials for authenticating the client (e.g., Bearer token)</li>
        <li><code className="bg-accent/10 px-1 rounded text-text">Accept</code> - Specifies the media types the client can understand</li>
        <li><code className="bg-accent/10 px-1 rounded text-text">User-Agent</code> - Identifies the client software making the request</li>
      </ul>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How to Use</h4>
      <ol className="list-decimal list-inside space-y-1 text-sm text-comment">
        <li>Click in a table cell to add or edit header names and values</li>
        <li>Each row represents one header (Key-Value pair)</li>
        <li>Headers are automatically sent with your HTTP request</li>
        <li>Use variables with <code className="bg-accent/10 px-1 rounded text-text">{`{{variable_name}}`}</code> syntax</li>
      </ol>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Example</h4>
      <pre className="bg-accent/10 p-2 rounded text-xs overflow-x-auto text-text text-text">
{`Authorization: Bearer {{auth_token}}
Content-Type: application/json
Accept: application/json`}
      </pre>
    </section>
  </div>
);

export const HttpQueryParamsHelp = () => (
  <div className="space-y-4">
    <section>
      <h3 className="font-semibold mb-2 text-text">HTTP Query Parameters</h3>
      <p className="text-sm text-comment mb-3">
        Query parameters are key-value pairs appended to the URL after a question mark (?).
        They allow you to pass data to the server as part of the URL.
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How Query Params Work</h4>
      <p className="text-sm text-comment mb-2">
        Query parameters are automatically appended to your request URL:
      </p>
      <pre className="bg-accent/10 p-2 rounded text-xs overflow-x-auto text-text mb-2">
{`https://api.example.com/users?page=1&limit=10`}
      </pre>
      <p className="text-sm text-comment">
        Multiple parameters are separated by ampersands (&amp;)
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How to Use</h4>
      <ol className="list-decimal list-inside space-y-1 text-sm text-comment">
        <li>Add parameter names in the Key column</li>
        <li>Add parameter values in the Value column</li>
        <li>Parameters are automatically URL-encoded</li>
        <li>Use variables with <code className="bg-accent/10 px-1 rounded text-text">{`{{variable_name}}`}</code> syntax</li>
      </ol>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Common Use Cases</h4>
      <ul className="list-disc list-inside space-y-1 text-sm text-comment">
        <li>Pagination: <code className="bg-accent/10 px-1 rounded text-text">page=1&limit=10</code></li>
        <li>Filtering: <code className="bg-accent/10 px-1 rounded text-text">status=active&category=tech</code></li>
        <li>Sorting: <code className="bg-accent/10 px-1 rounded text-text">sort=name&order=asc</code></li>
        <li>Search: <code className="bg-accent/10 px-1 rounded text-text">q=search+term</code></li>
      </ul>
    </section>
  </div>
);

export const HttpUrlFormHelp = () => (
  <div className="space-y-4">
    <section>
      <h3 className="font-semibold mb-2 text-text">URL-Encoded Form Data</h3>
      <p className="text-sm text-comment mb-3">
        URL-encoded form data (application/x-www-form-urlencoded) is the default encoding type
        for HTML forms. Data is encoded as key-value pairs in the request body.
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How It Works</h4>
      <p className="text-sm text-comment mb-2">
        Form data is sent in the request body with Content-Type: application/x-www-form-urlencoded
      </p>
      <pre className="bg-accent/10 p-2 rounded text-xs overflow-x-auto text-text">
{`username=john&password=secret123&remember=true`}
      </pre>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How to Use</h4>
      <ol className="list-decimal list-inside space-y-1 text-sm text-comment">
        <li>Add form field names in the Key column</li>
        <li>Add form field values in the Value column</li>
        <li>Data is automatically URL-encoded</li>
        <li>Content-Type header is set automatically</li>
        <li>Use variables with <code className="bg-accent/10 px-1 rounded text-text">{`{{variable_name}}`}</code> syntax</li>
      </ol>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">When to Use</h4>
      <ul className="list-disc list-inside space-y-1 text-sm text-comment">
        <li>Traditional HTML form submissions</li>
        <li>Login/authentication endpoints</li>
        <li>Simple data that doesn't require file uploads</li>
        <li>APIs that expect URL-encoded data</li>
      </ul>
    </section>
  </div>
);

export const HttpMultipartFormHelp = () => (
  <div className="space-y-4">
    <section>
      <h3 className="font-semibold mb-2 text-text">Multipart Form Data</h3>
      <p className="text-sm text-comment mb-3">
        Multipart form data (multipart/form-data) is used to upload files and send binary data
        along with text data in a single HTTP request.
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How It Works</h4>
      <p className="text-sm text-comment mb-2">
        Each form field is sent as a separate part with its own headers. Parts are separated by boundaries.
      </p>
      <p className="text-sm text-comment">
        Content-Type is set to: <code className="bg-accent/10 px-1 rounded text-text">multipart/form-data; boundary=...</code>
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How to Use</h4>
      <ol className="list-decimal list-inside space-y-1 text-sm text-comment">
        <li>Add field names in the Key column</li>
        <li>Add field values in the Value column</li>
        <li>For file uploads, specify file paths or use file reference syntax</li>
        <li>Use variables with <code className="bg-accent/10 px-1 rounded text-text">{`{{variable_name}}`}</code> syntax</li>
      </ol>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Common Use Cases</h4>
      <ul className="list-disc list-inside space-y-1 text-sm text-comment">
        <li>File uploads (images, documents, etc.)</li>
        <li>Uploading multiple files at once</li>
        <li>Sending binary data with metadata</li>
        <li>Forms that combine text and file inputs</li>
      </ul>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Example</h4>
      <pre className="bg-accent/10 p-2 rounded text-xs overflow-x-auto text-text">
{`name: John Doe
email: john@example.com
avatar: @/path/to/image.jpg`}
      </pre>
    </section>
  </div>
);

export const HttpCookiesHelp = () => (
  <div className="space-y-4">
    <section>
      <h3 className="font-semibold mb-2 text-text">HTTP Cookies</h3>
      <p className="text-sm text-comment mb-3">
        Cookies are key-value pairs sent to the server via the Cookie header.
        This block provides a convenient table interface for managing individual cookies
        instead of manually constructing the Cookie header string.
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How Cookies Work</h4>
      <p className="text-sm text-comment mb-2">
        Each row in the table becomes a cookie in the Cookie header:
      </p>
      <pre className="bg-accent/10 p-2 rounded text-xs overflow-x-auto text-text mb-2">
{`Cookie: session_id=abc123; theme=dark; lang=en`}
      </pre>
      <p className="text-sm text-comment">
        Multiple cookies are joined with semicolons and sent as a single Cookie header.
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How to Use</h4>
      <ol className="list-decimal list-inside space-y-1 text-sm text-comment">
        <li>Add cookie names in the Key column</li>
        <li>Add cookie values in the Value column</li>
        <li>Cookies are automatically combined into the Cookie header</li>
        <li>Use variables with <code className="bg-accent/10 px-1 rounded text-text">{`{{variable_name}}`}</code> syntax</li>
      </ol>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Example</h4>
      <pre className="bg-accent/10 p-2 rounded text-xs overflow-x-auto text-text">
{`session_id: abc123
theme: dark
lang: en`}
      </pre>
    </section>
  </div>
);

export const HttpPathParamsHelp = () => (
  <div className="space-y-4">
    <section>
      <h3 className="font-semibold mb-2 text-text">HTTP Path Parameters</h3>
      <p className="text-sm text-comment mb-3">
        Path parameters are variables embedded directly in the URL path, typically used to
        identify specific resources. They are enclosed in curly braces in the URL template.
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How Path Params Work</h4>
      <p className="text-sm text-comment mb-2">
        Path parameters replace placeholders in the URL:
      </p>
      <pre className="bg-accent/10 p-2 rounded text-xs overflow-x-auto text-text mb-2">
{`URL Template: https://api.example.com/users/{userId}/posts/{postId}
With params:  https://api.example.com/users/123/posts/456`}
      </pre>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How to Use</h4>
      <ol className="list-decimal list-inside space-y-1 text-sm text-comment">
        <li>Define path parameters in your URL using <code className="bg-accent/10 px-1 rounded text-text">{`{paramName}`}</code> syntax</li>
        <li>Add parameter names in the Key column (without braces)</li>
        <li>Add parameter values in the Value column</li>
        <li>Parameters are automatically substituted in the URL</li>
        <li>Use variables with <code className="bg-accent/10 px-1 rounded text-text">{`{{variable_name}}`}</code> syntax</li>
      </ol>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Common Use Cases</h4>
      <ul className="list-disc list-inside space-y-1 text-sm text-comment">
        <li>Resource identification: <code className="bg-accent/10 px-1 rounded text-text">/users/{`{id}`}</code></li>
        <li>Nested resources: <code className="bg-accent/10 px-1 rounded text-text">/users/{`{userId}`}/posts/{`{postId}`}</code></li>
        <li>RESTful API endpoints</li>
        <li>Dynamic routing based on identifiers</li>
      </ul>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Example</h4>
      <pre className="bg-accent/10 p-2 rounded text-xs overflow-x-auto text-text">
{`URL: /api/users/{userId}/orders/{orderId}

Path Params:
userId: 123
orderId: 789

Result: /api/users/123/orders/789`}
      </pre>
    </section>
  </div>
);

export const HttpJsonBodyHelp = () => (
  <div className="space-y-4">
    <section>
      <h3 className="font-semibold mb-2 text-text">JSON Request Body</h3>
      <p className="text-sm text-comment mb-3">
        JSON (JavaScript Object Notation) is the most common format for sending structured
        data in HTTP requests. It's human-readable and widely supported.
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How It Works</h4>
      <p className="text-sm text-comment mb-2">
        JSON data is sent in the request body with Content-Type: application/json
      </p>
      <pre className="bg-accent/10 p-2 rounded text-xs overflow-x-auto text-text">
{`{
  "name": "John Doe",
  "email": "john@example.com",
  "age": 30,
  "active": true
}`}
      </pre>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How to Use</h4>
      <ol className="list-decimal list-inside space-y-1 text-sm text-comment">
        <li>Write valid JSON in the editor</li>
        <li>Syntax highlighting helps identify errors</li>
        <li>Use variables with <code className="bg-accent/10 px-1 rounded text-text">{`{{variable_name}}`}</code> syntax</li>
        <li>Variables work in both keys and values</li>
        <li>Content-Type header is set automatically</li>
      </ol>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Features</h4>
      <ul className="list-disc list-inside space-y-1 text-sm text-comment">
        <li>Supports nested objects and arrays</li>
        <li>Variable interpolation for dynamic values</li>
        <li>Syntax validation before sending</li>
        <li>Automatic formatting and indentation</li>
      </ul>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Example with Variables</h4>
      <pre className="bg-accent/10 p-2 rounded text-xs overflow-x-auto text-text">
{`{
  "username": "{{username}}",
  "password": "{{password}}",
  "timestamp": "{{$timestamp}}",
  "profile": {
    "firstName": "{{firstName}}",
    "lastName": "{{lastName}}"
  }
}`}
      </pre>
    </section>
  </div>
);

export const HttpYmlBodyHelp = () => (
  <div className="space-y-4">
    <section>
      <h3 className="font-semibold mb-2 text-text">YAML Request Body</h3>
      <p className="text-sm text-comment mb-3">
        YAML (YAML Ain't Markup Language) is a human-friendly data serialization format
        commonly used for configuration files and data exchange between languages.
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How It Works</h4>
      <p className="text-sm text-comment mb-2">
        YAML data is sent in the request body with Content-Type: application/x-yaml or text/yaml
      </p>
      <pre className="bg-accent/10 p-2 rounded text-xs overflow-x-auto text-text">
{`name: John Doe
email: john@example.com
age: 30
active: true
roles:
  - admin
  - user`}
      </pre>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How to Use</h4>
      <ol className="list-decimal list-inside space-y-1 text-sm text-comment">
        <li>Write valid YAML in the editor</li>
        <li>Use indentation (spaces) for nesting</li>
        <li>Use variables with <code className="bg-accent/10 px-1 rounded text-text">{`{{variable_name}}`}</code> syntax</li>
        <li>Variables work in both keys and values</li>
        <li>Content-Type header is set automatically</li>
      </ol>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Common Use Cases</h4>
      <ul className="list-disc list-inside space-y-1 text-sm text-comment">
        <li>Kubernetes and Docker APIs</li>
        <li>Configuration management APIs</li>
        <li>CI/CD pipeline APIs</li>
        <li>APIs that accept YAML payloads</li>
      </ul>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Example with Variables</h4>
      <pre className="bg-accent/10 p-2 rounded text-xs overflow-x-auto text-text">
{`apiVersion: v1
kind: ConfigMap
metadata:
  name: "{{config_name}}"
  namespace: "{{namespace}}"
data:
  key: "{{config_value}}"`}
      </pre>
    </section>
  </div>
);

export const HttpXmlBodyHelp = () => (
  <div className="space-y-4">
    <section>
      <h3 className="font-semibold mb-2 text-text">XML Request Body</h3>
      <p className="text-sm text-comment mb-3">
        XML (eXtensible Markup Language) is a markup language used for encoding documents
        in a format that is both human-readable and machine-readable.
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How It Works</h4>
      <p className="text-sm text-comment mb-2">
        XML data is sent in the request body with Content-Type: application/xml or text/xml
      </p>
      <pre className="bg-accent/10 p-2 rounded text-xs overflow-x-auto text-text">
{`<?xml version="1.0" encoding="UTF-8"?>
<user>
  <name>John Doe</name>
  <email>john@example.com</email>
  <age>30</age>
</user>`}
      </pre>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How to Use</h4>
      <ol className="list-decimal list-inside space-y-1 text-sm text-comment">
        <li>Write valid XML in the editor</li>
        <li>Include XML declaration if required by the API</li>
        <li>Use variables with <code className="bg-accent/10 px-1 rounded text-text">{`{{variable_name}}`}</code> syntax</li>
        <li>Variables work in element content and attributes</li>
        <li>Content-Type header is set automatically</li>
      </ol>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Common Use Cases</h4>
      <ul className="list-disc list-inside space-y-1 text-sm text-comment">
        <li>SOAP web services</li>
        <li>Legacy APIs that require XML</li>
        <li>Configuration files and data exchange</li>
        <li>Document-centric applications</li>
      </ul>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Example with Variables</h4>
      <pre className="bg-accent/10 p-2 rounded text-xs overflow-x-auto text-text">
{`<?xml version="1.0" encoding="UTF-8"?>
<request>
  <userId>{{userId}}</userId>
  <action type="{{actionType}}">
    <timestamp>{{$timestamp}}</timestamp>
  </action>
</request>`}
      </pre>
    </section>
  </div>
);

export const RequestOptionsHelp = () => (
  <div className="space-y-4">
    <section>
      <h3 className="font-semibold mb-2 text-text">Request Options</h3>
      <p className="text-sm text-comment mb-3">
        Per-request options that override global settings. Use key-value pairs to configure
        how this specific request is sent.
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Available Options</h4>
      <ul className="list-disc list-inside space-y-1 text-sm text-comment">
        <li><code className="bg-accent/10 px-1 rounded text-text">follow_redirects</code> - Follow HTTP redirects automatically. Set to <code className="bg-accent/10 px-1 rounded text-text">false</code> to inspect 3xx redirect responses directly.</li>
      </ul>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Example</h4>
      <pre className="bg-accent/10 p-2 rounded text-xs overflow-x-auto text-text">
{`follow_redirects: false`}
      </pre>
    </section>
  </div>
);
