# HTTP Archive (HAR) Importer for Voiden

Import HTTP Archive (`.har`) files captured from browser Developer Tools and automatically convert network requests into native Voiden `.void` request files.

## Features
- Import `.har` files
- Group requests by page title or domain hostname
- Extract headers, cookies, query parameters, and request bodies
- Supports JSON, XML, Form Data (URL-encoded), Multipart, and Plain Text bodies
- Option to ignore static assets (images, CSS, JS, fonts, etc.)
- Progress tracking and cancellation support
