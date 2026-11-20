export const metricTypes = ['number', 'count', 'duration', 'checkbox', 'choice', 'text'] as const;
export type MetricType = (typeof metricTypes)[number];
