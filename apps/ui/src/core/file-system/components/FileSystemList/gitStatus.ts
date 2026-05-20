import { GitStatus } from "./types";

export function getGitStatusClass(gitStatus: GitStatus | null | undefined): string {
  if (!gitStatus) return "";
  if ((gitStatus.working_dir && gitStatus.working_dir.startsWith("?")) || (gitStatus.index && gitStatus.index.startsWith("?")))
    return "text-vcs-added";
  if (gitStatus.working_dir === "M" || gitStatus.index === "M") return "text-vcs-modified";
  if (gitStatus.working_dir === "A" || gitStatus.index === "A") return "text-vcs-added";
  if (gitStatus.working_dir === "D" || gitStatus.index === "D") return "text-red-500";
  if (gitStatus.working_dir === "R" || gitStatus.index === "R") return "text-vcs-modified";
  return "";
}
