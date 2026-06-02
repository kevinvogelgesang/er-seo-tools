export interface RoadmapPromptArgs {
  webappUrl: string;
  roadmapId: string;
  token: string;
}

export function composeRoadmapPayload({ webappUrl, roadmapId, token }: RoadmapPromptArgs): string {
  return [
    'Generate a technical SEO roadmap for this site.',
    '',
    `Webapp: ${webappUrl}`,
    `Roadmap ID: ${roadmapId}`,
    `Access token: ${token}`,
    '(Expires in 1h)',
    '',
    'Fetch the audit payload, write the prioritized technical-SEO roadmap, and post it back to the dashboard.',
  ].join('\n');
}
