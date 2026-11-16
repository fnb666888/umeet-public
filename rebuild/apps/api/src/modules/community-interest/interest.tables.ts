export interface InterestTables {
  interest_preferences: { user_id: string; data: string; updated_at: Date };
  interest_polls: {
    id: string;
    post_id: string;
    author_id: string;
    question: string;
    options: string;
    ends_at: Date;
    state: string;
    version: number;
    created_at: Date;
  };
  interest_votes: { poll_id: string; user_id: string; option_id: number; created_at: Date };
  interest_sources: {
    id: string;
    name: string;
    board: string;
    kind: string;
    url: string;
    terms_url: string;
    enabled: number;
    approved: number;
    etag: string | null;
    last_error: string;
    fetched_at: Date | null;
    due_at: Date;
  };
  interest_news: {
    id: string;
    source_id: string;
    external_id: string;
    dedup_key: string;
    title: string;
    url: string;
    summary: string;
    board: string;
    language: string;
    published_at: Date;
    created_at: Date;
    state: string;
  };
  interest_news_quotas: { board: string; business_day: string; count: number };
  interest_forecast_days: {
    business_day: string;
    state: string;
    reason: string;
    created_at: Date;
    updated_at: Date;
  };
  interest_forecast_templates: {
    id: string;
    name: string;
    field: string;
    board: string;
    source_id: string;
    target: string;
    days_ahead: number;
    enabled: number;
  };
  interest_forecasts: {
    id: string;
    business_day: string;
    template_id: string;
    field: string;
    board: string;
    title: string;
    probability: number;
    reasoning: string;
    counter_evidence: string;
    evidence: string;
    information_at: Date;
    deadline: Date;
    rules: string;
    created_at: Date;
    state: string;
    outcome: number | null;
    resolution: string;
    result_evidence: string;
  };
  interest_forecast_runs: {
    id: string;
    business_day: string;
    state: string;
    data: string;
    created_at: Date;
  };
  interest_comments: {
    id: string;
    target_type: string;
    target_id: string;
    author_id: string;
    body: string;
    created_at: Date;
    hidden: number;
  };
  interest_actions: {
    user_id: string;
    target_type: string;
    target_id: string;
    kind: string;
    created_at: Date;
  };
  interest_reports: {
    id: string;
    user_id: string;
    target_type: string;
    target_id: string;
    comment_id: string | null;
    reason: string;
    state: string;
    resolution: string;
    created_at: Date;
  };
  interest_usage: { business_day: string; count: number };
}
