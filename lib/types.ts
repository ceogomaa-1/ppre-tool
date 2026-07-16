export type LeadStatus = "verified" | "reviewing" | "queued" | "attention";

export type Evidence = {
  label: string;
  url: string;
  detail: string;
  capturedAt: string;
};

export type PropertyLead = {
  id: string;
  datasetId?: string;
  owner: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  email: string | null;
  phone: string | null;
  propertyType: string;
  confidence: number;
  status: LeadStatus;
  sources: Evidence[];
  updatedAt: string;
};

export type ParsedDataset = {
  fileName: string;
  file: File;
  headers: string[];
  rows: Record<string, string>[];
  mapping: Record<string, string | null>;
};

export type DatasetSummary = {
  id: string;
  name: string;
  rowCount: number;
  processedCount: number;
  matchedCount: number;
  status: string;
  createdAt: string;
};

export type EnrichmentJob = {
  id: string;
  datasetId: string;
  status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
  rowsTotal: number;
  rowsCompleted: number;
  rowsFailed: number;
  estimatedCostUsd: number;
  webSearchCalls: number;
  costEstimateComplete: boolean;
  costLimitUsd: number | null;
  createdAt: string;
};
