/**
 * Help content for core Voiden nodes
 */

import React from "react";

export const RuntimeVariablesHelp = () => (
  <div className="space-y-4">
    <section>
      <h3 className="font-semibold mb-2 text-text">Runtime Variables (Void Block)</h3>
      <p className="text-sm text-comment mb-3">
        Runtime Variables allow you to capture and store values from a request's own response,
        which can then be used in subsequent requests. This is essential for workflows where one
        request depends on data from a previous one (e.g. an auth token, a created record's ID).
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How It Works</h4>
      <p className="text-sm text-comment mb-2">
        In the Key column, name the variable. In the Value column, write a capture expression
        pointing at the response (or the request that was just sent) — not a literal value.
        Once captured, reference it anywhere with{" "}
        <code className="bg-accent/10 px-1 rounded text-text">{`{{process.variable_name}}`}</code> —
        note the <code className="bg-accent/10 px-1 rounded text-text">process.</code> prefix; a bare{" "}
        <code className="bg-accent/10 px-1 rounded text-text">{`{{variable_name}}`}</code> won't resolve.
      </p>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Capture Expressions</h4>
      <ul className="list-disc list-inside space-y-1 text-sm text-comment">
        <li><code className="bg-accent/10 px-1 rounded text-text">{`{{$res.body.path}}`}</code> — a field from the response body (dot/bracket path, e.g. <code className="bg-accent/10 px-1 rounded text-text">$res.body.data.id</code>)</li>
        <li><code className="bg-accent/10 px-1 rounded text-text">{`{{$res.headers.name}}`}</code>, <code className="bg-accent/10 px-1 rounded text-text">{`{{$res.status}}`}</code>, <code className="bg-accent/10 px-1 rounded text-text">{`{{$res.statusText}}`}</code>, <code className="bg-accent/10 px-1 rounded text-text">{`{{$res.time}}`}</code>, <code className="bg-accent/10 px-1 rounded text-text">{`{{$res.size}}`}</code></li>
        <li><code className="bg-accent/10 px-1 rounded text-text">{`{{$req.url}}`}</code>, <code className="bg-accent/10 px-1 rounded text-text">{`{{$req.method}}`}</code>, <code className="bg-accent/10 px-1 rounded text-text">{`{{$req.headers.name}}`}</code>, <code className="bg-accent/10 px-1 rounded text-text">{`{{$req.body.path}}`}</code> — from the request that was just sent</li>
      </ul>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">How to Use</h4>
      <ol className="list-decimal list-inside space-y-1 text-sm text-comment">
        <li>Add a Runtime Variables block after your request</li>
        <li>In the Key column, enter the variable name you want to create</li>
        <li>In the Value column, enter a capture expression (see above)</li>
        <li>Run the request to capture the values</li>
        <li>Use the captured variable in subsequent requests as <code className="bg-accent/10 px-1 rounded text-text">{`{{process.variable_name}}`}</code></li>
      </ol>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Common Use Cases</h4>
      <ul className="list-disc list-inside space-y-1 text-sm text-comment">
        <li>Capturing authentication tokens from login responses</li>
        <li>Storing IDs from create operations for use in update/delete requests</li>
        <li>Chaining requests where each depends on the previous response</li>
        <li>Building test workflows with dynamic data</li>
      </ul>
    </section>

    <section>
      <h4 className="font-semibold mb-2 text-text">Example</h4>
      <pre className="bg-accent/10 p-2 rounded text-xs overflow-x-auto text-text">
{`// Response from login request:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": "12345"
}

// Runtime Variables block (Key | Value):
authToken    | {{$res.body.token}}
currentUserId | {{$res.body.userId}}

// Use in a later request:
Authorization: Bearer {{process.authToken}}
/api/users/{{process.currentUserId}}/profile`}
      </pre>
    </section>
  </div>
);
