import { Octokit } from '@octokit/rest'

export interface RepoRef {
  owner: string
  repo: string
  defaultBranch?: string
}

export function parseRepoUrl(url: string): RepoRef | null {
  try {
    // Supports https://github.com/owner/repo(.git)
    const m = url.match(/github\.com\/(.+?)\/(.+?)(?:\.git)?$/)
    if (!m) return null
    return { owner: m[1], repo: m[2] }
  } catch { return null }
}

export async function commitFilesToRepo(
  repoUrl: string,
  files: Array<{ path: string; content: string }>,
  message: string
): Promise<{ commitSha: string; branch: string }> {
  const ref = parseRepoUrl(repoUrl)
  if (!ref) throw new Error('Invalid github_repo_url')

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

  // Get default branch
  const repo = await octokit.repos.get({ owner: ref.owner, repo: ref.repo })
  const branch = repo.data.default_branch

  // Get latest commit sha of branch
  const refData = await octokit.git.getRef({ owner: ref.owner, repo: ref.repo, ref: `heads/${branch}` })
  const baseSha = refData.data.object.sha

  // Create tree with files (base64-encoded)
  const tree = await octokit.git.createTree({
    owner: ref.owner,
    repo: ref.repo,
    base_tree: baseSha,
    tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.content }))
  })

  // Create commit
  const commit = await octokit.git.createCommit({
    owner: ref.owner,
    repo: ref.repo,
    message,
    tree: tree.data.sha,
    parents: [baseSha]
  })

  // Update ref
  await octokit.git.updateRef({ owner: ref.owner, repo: ref.repo, ref: `heads/${branch}`, sha: commit.data.sha, force: false })

  return { commitSha: commit.data.sha, branch }
}

export async function createTag(
  repoUrl: string,
  commitSha: string,
  tagName: string,
  tagMessage = tagName
) {
  const ref = parseRepoUrl(repoUrl)
  if (!ref) throw new Error('Invalid github_repo_url')
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

  // Create lightweight ref tag
  await octokit.git.createRef({ owner: ref.owner, repo: ref.repo, ref: `refs/tags/${tagName}`, sha: commitSha })
}


