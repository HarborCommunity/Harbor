import { sep } from "@tauri-apps/api/path";
import { readDir } from "@tauri-apps/plugin-fs";

const SUBTITLE_EXT = /\.(ass|srt|ssa|vtt|sub)$/i;
const MAX_DEPTH = 8;
const MAX_DIRECTORIES = 2_048;
const MAX_SUBTITLES = 20_000;
const CONCURRENT_READS = 4;

export async function scanLocalSubtitles(folder: string, signal?: AbortSignal): Promise<string[]> {
  if (!folder.trim()) return [];
  signal?.throwIfAborted();

  const separator = sep();
  const directories = [{ path: folder, depth: 0 }];
  const subtitles: string[] = [];
  let unreadableDirectories = 0;
  let reachedLimit = false;
  let offset = 0;

  // Read the shallowest directories first and bound concurrent work on slow disks.
  while (offset < directories.length && subtitles.length < MAX_SUBTITLES) {
    const batch = directories.slice(offset, offset + CONCURRENT_READS);
    offset += batch.length;
    const results = await Promise.allSettled(batch.map(({ path }) => readDir(path)));
    signal?.throwIfAborted();

    for (const [index, result] of results.entries()) {
      const { path, depth } = batch[index];
      if (result.status === "rejected") {
        if (depth === 0) {
          throw new Error("Unable to read the local subtitle folder.", { cause: result.reason });
        }
        unreadableDirectories++;
        continue;
      }

      // DirEntry names are individual path components, so they do not need a native join call.
      const hasTrailingSeparator =
        path.endsWith(separator) || (separator === "\\" && path.endsWith("/"));
      const prefix = hasTrailingSeparator ? path : path + separator;
      const entries = result.value.filter(
        (entry) =>
          !entry.isSymlink &&
          ((entry.isDirectory && depth < MAX_DEPTH) ||
            (entry.isFile && SUBTITLE_EXT.test(entry.name))),
      );
      entries.sort((a, b) => {
        if (a.name < b.name) return -1;
        if (a.name > b.name) return 1;
        return 0;
      });

      for (const entry of entries) {
        if (entry.isDirectory) {
          if (directories.length === MAX_DIRECTORIES) {
            reachedLimit = true;
            continue;
          }
          directories.push({ path: prefix + entry.name, depth: depth + 1 });
        } else if (subtitles.length < MAX_SUBTITLES) {
          subtitles.push(prefix + entry.name);
        } else {
          reachedLimit = true;
        }
      }
    }
  }

  if (unreadableDirectories > 0) {
    console.warn(`[Local subtitles] Skipped ${unreadableDirectories} unreadable subfolders.`);
  }
  if (reachedLimit || offset < directories.length) {
    console.warn("[Local subtitles] The folder scan reached its directory or subtitle limit.");
  }
  return subtitles;
}
