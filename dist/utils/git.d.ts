export declare function getGitDiff(base?: string): string;
export declare function getHeadSha(): string;
export declare function gitCommitAll(iteration: number, summary: string): void;
export declare function gitRevertToBaseline(baselineSha: string): void;
export declare function gitCommitDescendOnly(iteration: number, reason: string): void;
