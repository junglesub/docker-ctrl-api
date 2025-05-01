// 추가: GitHub 상태 업데이트 함수

import { GithubInfo } from "../interface";

export async function updateGitHubCommitStatus(params: {
  state: "pending" | "success" | "failure" | "error";
  description: string;
  githubInfo: GithubInfo;
}) {
  const {
    state,
    description,
    githubInfo: { githubRepo, commitSha, githubToken },
  } = params;
  const [owner, repo] = githubRepo.split("/");
  const url = `https://api.github.com/repos/${owner}/${repo}/statuses/${commitSha}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      state,
      description,
      context: "docker-ctrl-api",
    }),
  });

  if (!res.ok) {
    console.error("Failed to update GitHub status:", await res.text());
  } else {
    console.log(`GitHub status updated: ${state}`);
  }
}
