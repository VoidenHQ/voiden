import * as https from "https";
import { app } from "electron";
import { ExtensionData } from "src/shared/types";

const COMMUNITY_REGISTRY_URL = "https://raw.githubusercontent.com/VoidenHQ/plugin-registry/main/extensions.json";

const readmeCache = new Map<string, { content: string; timestamp: number }>();
const changelogCache = new Map<string, { data: any[]; timestamp: number }>();
const ONE_DAY = 24 * 60 * 60 * 1000;

// Use Node.js https instead of fetch() — fetch() in the Electron main process
// routes through Chromium's network service which can crash under load at startup.
function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      headers: {
        'User-Agent': `Voiden/${app.getVersion()} (${process.platform}; ${process.arch})`,
        'Accept': 'application/vnd.github.v3+json',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
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

export async function fetchReadme(repo: string): Promise<string> {
  const cacheKey = repo;
  const cached = readmeCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < ONE_DAY) {
    return cached.content;
  }
  const branches = ['main', 'master'];
  for (const branch of branches) {
    try {
      const content = await httpsGet(`https://raw.githubusercontent.com/${repo}/${branch}/README.md`);
      readmeCache.set(cacheKey, { content, timestamp: Date.now() });
      return content;
    } catch {
      // try next branch
    }
  }
  return '';
}

export async function fetchManifest(repo: string): Promise<Record<string, any> | null> {
  // Try GitHub release first; fall back to raw branch file for plugins without a release yet.
  try {
    const raw = await httpsGet(`https://github.com/${repo}/releases/latest/download/manifest.json`);
    return JSON.parse(raw);
  } catch {
    for (const branch of ['main', 'master']) {
      try {
        const raw = await httpsGet(`https://raw.githubusercontent.com/${repo}/${branch}/manifest.json`);
        return JSON.parse(raw);
      } catch {
        // try next branch
      }
    }
    return null;
  }
}

export async function fetchChangelog(repo: string): Promise<any[] | null> {
  const cached = changelogCache.get(repo);
  if (cached && Date.now() - cached.timestamp < ONE_DAY) {
    return cached.data;
  }
  const urls = [
    `https://github.com/${repo}/releases/latest/download/changelog.json`,
    `https://raw.githubusercontent.com/${repo}/main/changelog.json`,
  ];
  for (const url of urls) {
    try {
      const raw = await httpsGet(url);
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        changelogCache.set(repo, { data, timestamp: Date.now() });
        return data;
      }
    } catch {
      // try next URL
    }
  }
  return null;
}

export async function getRemoteExtensions(): Promise<ExtensionData[]> {
  try {
    const raw = await httpsGet(COMMUNITY_REGISTRY_URL);
    const parsed = JSON.parse(raw);
    const remoteExtensionsRaw: any[] = (Array.isArray(parsed) ? parsed : [])
      .filter((e: any) => e.type === 'community');

    return remoteExtensionsRaw.map(
      (ext): Omit<ExtensionData, "enabled"> => ({
        id: ext.id,
        name: ext.name,
        description: ext.description,
        author: ext.author,
        version: ext.version,
        type: ext.type ?? "community",
        readme: "",
        repo: ext.repo,
        icon: ext.icon,
        voidenVersion: ext.voidenVersion,
      }),
    );
  } catch {
    return [];
  }
}
