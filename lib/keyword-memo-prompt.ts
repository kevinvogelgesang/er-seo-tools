export interface KeywordMemoPromptArgs {
  webappUrl: string;
  memoId: string;
  token: string;
}

export function composeKeywordMemoPayload({ webappUrl, memoId, token }: KeywordMemoPromptArgs): string {
  return [
    'Generate a keyword strategy memo for this site.',
    '',
    `Webapp: ${webappUrl}`,
    `Memo ID: ${memoId}`,
    `Access token: ${token}`,
    '(Expires in 1h)',
    '',
    'Fetch the keyword research payload, write the keyword strategy memo, and post it back to the dashboard.',
  ].join('\n');
}
