import path from "path";
import fs from "fs/promises";
import * as https from "https";
import { app } from "electron";
import { ExtensionData } from "src/shared/types";

const EXTENSIONS_REPO = "VoidenHQ/plugins";
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const remoteExtensionsPath = path.join(app.getPath("userData"), "remoteExtensions.json");
const readmeCache = new Map<string, { content: string; timestamp: number }>();

// Use Node.js https instead of fetch() — fetch() in the Electron main process
// routes through Chromium's network service which can crash under load at startup.
function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      headers: {
        'User-Agent': `Voiden/${app.getVersion()} (${process.platform}; ${process.arch})`,
        'Accept': 'application/vnd.github.v3+json',
      },
    };
    https.get(url, reqOptions, (res) => {
      // Follow one level of redirect (GitHub sometimes redirects)
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, reqOptions, (r2) => {
          let data = '';
          r2.on('data', (c) => (data += c));
          r2.on('end', () => resolve(data));
          r2.on('error', reject);
        }).on('error', reject);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

export async function fetchReadme(url: string): Promise<string> {
  const cached = readmeCache.get(url);
  if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
    return cached.content;
  }
  try {
    const content = await httpsGet(url);
    readmeCache.set(url, { content, timestamp: Date.now() });
    return content;
  } catch {
    return '';
  }
}

export async function getRemoteExtensions(): Promise<ExtensionData[]> {
  let cachedData: { timestamp: number; data: ExtensionData[] } | null = null;

  try {
    const fileContent = await fs.readFile(remoteExtensionsPath, "utf8");
    cachedData = JSON.parse(fileContent);
  } catch {
    cachedData = null;
  }

  const now = Date.now();
  if (cachedData && cachedData.timestamp && now - cachedData.timestamp < CACHE_DURATION) {
    return cachedData.data;
  }

  try {
    const raw = await httpsGet(`https://api.github.com/repos/${EXTENSIONS_REPO}/contents/extensions.json?ref=main`);
    const fileJson = JSON.parse(raw);
    const remoteJsonString = Buffer.from(fileJson.content, "base64").toString("utf8");
    const remoteExtensionsRaw: ExtensionData[] = JSON.parse(remoteJsonString);

    const remoteExtensions: ExtensionData[] = remoteExtensionsRaw.map(
      (ext): Omit<ExtensionData, "enabled"> => ({
        id: ext.id,
        name: ext.name,
        description: ext.description,
        author: ext.author,
        version: ext.version,
        type: "community",
        readme: "",
        repo: ext.repo,
      }),
    );

    await fs.writeFile(remoteExtensionsPath, JSON.stringify({ timestamp: now, data: remoteExtensions }), "utf8");
    return remoteExtensions;
  } catch {
    return cachedData ? cachedData.data : [];
  }
}
