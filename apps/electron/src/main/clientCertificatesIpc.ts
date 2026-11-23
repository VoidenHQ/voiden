/**
 * IPC for Settings → Network → Client certificates. Edits the active project's
 * `.voiden/certificates.yaml` (see @voiden/executors clientCertificates).
 * Key material is only read here, to check a profile; it never goes back to the renderer.
 */
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import tls from "node:tls";
import {
  CERTIFICATES_FILE,
  ClientCertificateError,
  loadClientCertificateProfile,
  readCertificateProfiles,
  serializeCertificateProfiles,
  type ClientCertificateProfile,
} from "@voiden/executors";
import { getActiveProject } from "./state";
import { replaceVariablesSecure } from "./env";

export type ClientCertificateList =
  | { projectRoot: null }
  | { projectRoot: string; file: string; exists: boolean; profiles: ClientCertificateProfile[]; error?: string };

export type ClientCertificateCheck =
  | { ok: true; subject?: string; issuer?: string; validTo?: string; expired?: boolean }
  | { ok: false; error: string };

const message = (err: any) => (err instanceof ClientCertificateError ? err.message : String(err?.message ?? err));

/** Store paths inside the project as `./relative` so the file works for everyone who clones it. */
function portablePath(projectRoot: string, p?: string): string | undefined {
  const value = p?.trim();
  if (!value || value.includes("{{") || !path.isAbsolute(value)) return value || undefined;
  const rel = path.relative(projectRoot, value);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return value;
  return "./" + rel.split(path.sep).join("/");
}

async function list(event: IpcMainInvokeEvent): Promise<ClientCertificateList> {
  const projectRoot = await getActiveProject(event);
  if (!projectRoot) return { projectRoot: null };
  const file = path.join(projectRoot, CERTIFICATES_FILE);
  try {
    const { exists, profiles } = await readCertificateProfiles(projectRoot);
    return { projectRoot, file, exists, profiles };
  } catch (err) {
    return { projectRoot, file, exists: true, profiles: [], error: message(err) };
  }
}

async function save(event: IpcMainInvokeEvent, profiles: ClientCertificateProfile[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const projectRoot = await getActiveProject(event);
  if (!projectRoot) return { ok: false, error: "Open a project to edit its client certificates." };
  try {
    const { text } = await readCertificateProfiles(projectRoot).catch(() => ({ text: "" }));
    const portable = profiles.map((p) => ({
      ...p,
      cert: portablePath(projectRoot, p.cert),
      key: portablePath(projectRoot, p.key),
      pfx: portablePath(projectRoot, p.pfx),
      ca: portablePath(projectRoot, p.ca),
    }));
    const out = serializeCertificateProfiles(text, portable);
    const file = path.join(projectRoot, CERTIFICATES_FILE);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, out, "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

const certName = (o: any) => (o ? o.CN || Object.entries(o).map(([k, v]) => `${k}=${v}`).join(", ") : undefined);

/** Loads one profile (resolving {{variables}} against the active environment) and reports subject / expiry. */
async function check(event: IpcMainInvokeEvent, profile: ClientCertificateProfile): Promise<ClientCertificateCheck> {
  const projectRoot = await getActiveProject(event);
  if (!projectRoot) return { ok: false, error: "Open a project to check its client certificates." };
  try {
    const { connect } = await loadClientCertificateProfile(profile, {
      projectRoot,
      replaceVar: (t) => replaceVariablesSecure(t, projectRoot, undefined, event),
    });
    const socket = new tls.TLSSocket(null as any, { secureContext: tls.createSecureContext(connect) });
    try {
      const cert: any = socket.getCertificate();
      const validTo = cert?.valid_to ? new Date(cert.valid_to) : undefined;
      const valid = validTo && !isNaN(validTo.getTime());
      return {
        ok: true,
        subject: certName(cert?.subject),
        issuer: certName(cert?.issuer),
        validTo: valid ? validTo!.toISOString() : undefined,
        expired: valid ? validTo!.getTime() < Date.now() : undefined,
      };
    } finally {
      socket.destroy();
    }
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

export function registerClientCertificateIpc() {
  ipcMain.handle("client-certificates:list", (e) => list(e));
  ipcMain.handle("client-certificates:save", (e, profiles: ClientCertificateProfile[]) => save(e, profiles));
  ipcMain.handle("client-certificates:check", (e, profile: ClientCertificateProfile) => check(e, profile));
}
