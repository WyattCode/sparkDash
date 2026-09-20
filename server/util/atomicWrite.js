import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";

/**
 * Replace a file only after a complete temporary write in the same directory.
 * Never unlink/chmod the destination or truncate it as an error fallback:
 * failure must leave the previous configuration (and its permissions) intact.
 */
export function atomicWrite(filePath, contents, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let created = false;
  let fd;
  try {
    fd = fs.openSync(tmp, "wx", mode);
    created = true;
    fs.writeFileSync(fd, contents);
    fs.fchmodSync(fd, mode);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, filePath);
  } catch (err) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* Preserve the original failure. */ }
    }
    if (created) {
      try { fs.unlinkSync(tmp); } catch { /* Best-effort temporary cleanup. */ }
    }
    throw err;
  }
}

export default atomicWrite;
