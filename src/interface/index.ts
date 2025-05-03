export interface KeyConfigItem {
  container_name: string;
  secret_key: string;
}

export interface KeyConfig {
  keys: {
    [id: string]: KeyConfigItem;
  };
}

export interface GithubInfo {
  commitSha: string;
  githubRepo: string;
}
