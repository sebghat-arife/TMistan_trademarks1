/**
 * Hand-maintained subset of the Supabase schema used by the frontend.
 * Regenerate with `supabase gen types typescript --linked > src/lib/database.types.ts`
 * once the project is linked; keep the shapes below in sync with
 * supabase/migrations/*.sql.
 */

export type ReviewStatus = 'unreviewed' | 'reviewed' | 'needs_correction' | 'verified'
export type ImageStatus = 'matched' | 'unmatched' | 'ambiguous' | 'needs_review'
export type ImageType = 'logo' | 'mark_print' | 'source_crop' | 'other'

export type TrademarkRow = {
  id: string
  record_number: string | null
  serial_number: string
  mark_name: string | null
  mark_print: string | null
  applicant_name: string | null
  applicant_address: string | null
  trademark_class: string | null
  goods_and_services: string | null
  application_type: string | null
  attorney_or_representative: string | null
  publication_date: string | null
  objection_deadline: string | null
  official_gazette_number: string
  registration_number: string | null
  application_number: string | null
  new_address: string | null
  old_address: string | null
  new_owner: string | null
  old_owner: string | null
  source_page: string | null
  review_note: string | null
  source_file: string | null
  source_sheet: string | null
  source_row: number | null
  created_at: string
  updated_at: string
  is_published: boolean
  review_status: ReviewStatus
  reviewed_by: string | null
  reviewed_at: string | null
  review_comment: string | null
  import_job_id: string | null
  created_by_job_id: string | null
  class_numbers: number[] | null
}

/**
 * Columns anonymous/authenticated clients may read directly from
 * `public.trademarks` (column-level grants, migration 0600). Everything else —
 * attorney_or_representative, review fields, source-file provenance, import
 * ids — is admin-only and reachable through the `admin_*` functions.
 * Keep this list identical to the GRANT in 20261012000600_data_management.sql.
 */
export const TRADEMARK_PUBLIC_COLUMNS = [
  'id', 'record_number', 'serial_number', 'mark_name', 'mark_print', 'applicant_name', 'applicant_address',
  'trademark_class', 'class_numbers', 'goods_and_services', 'application_type', 'publication_date',
  'objection_deadline', 'official_gazette_number', 'registration_number', 'application_number',
  'new_address', 'old_address', 'new_owner', 'old_owner', 'source_page', 'review_status', 'is_published',
  'created_at', 'updated_at',
] as const
export type TrademarkPublicRow = Pick<TrademarkRow, (typeof TRADEMARK_PUBLIC_COLUMNS)[number]>

export type TrademarkImageRow = {
  id: string
  trademark_id: string | null
  image_type: ImageType
  status: ImageStatus
  match_method: string | null
  storage_bucket: string
  storage_path: string
  thumbnail_path: string | null
  original_filename: string | null
  source_folder: string | null
  gazette_number: string | null
  serial_number: string | null
  width: number | null
  height: number | null
  byte_size: number | null
  content_type: string | null
  content_hash: string | null
  sort_order: number
  import_job_id: string | null
  created_by_job_id: string | null
  review_note: string | null
  created_at: string
  updated_at: string
}

/** Public columns of `trademark_images` (see TRADEMARK_PUBLIC_COLUMNS). */
export const TRADEMARK_IMAGE_PUBLIC_COLUMNS = [
  'id', 'trademark_id', 'image_type', 'status', 'storage_bucket', 'storage_path', 'thumbnail_path',
  'gazette_number', 'serial_number', 'width', 'height', 'byte_size', 'content_type', 'sort_order',
  'created_at', 'updated_at',
] as const
export type TrademarkImagePublicRow = Pick<TrademarkImageRow, (typeof TRADEMARK_IMAGE_PUBLIC_COLUMNS)[number]>

export type GazetteRow = {
  id: string
  gazette_number: string
  publication_date: string | null
  title: string | null
  description: string | null
  source_file: string | null
  created_at: string
  updated_at: string
}

export type GazetteSummaryRow = Omit<GazetteRow, 'updated_at'> & {
  trademark_count: number
  image_count: number
  first_publication_date: string | null
  last_publication_date: string | null
  sort_key: number | null
}

export type TrademarkSearchResult = {
  id: string
  serial_number: string
  record_number: string | null
  mark_name: string | null
  applicant_name: string | null
  applicant_address: string | null
  trademark_class: string | null
  class_numbers: number[] | null
  goods_and_services: string | null
  application_type: string | null
  publication_date: string | null
  objection_deadline: string | null
  official_gazette_number: string
  source_page: string | null
  review_status: ReviewStatus
  primary_image_bucket: string | null
  primary_image_path: string | null
  primary_thumbnail_path: string | null
  rank: number | null
  total_count: number
}

export type SearchTrademarksArgs = {
  p_query?: string | null
  p_mark?: string | null
  p_applicant?: string | null
  p_serial?: string | null
  p_gazette?: string | null
  p_classes?: number[] | null
  p_goods?: string | null
  p_application_type?: string | null
  /** Accepted for compatibility; ignored server-side since migration 0600 (attorney is never public). */
  p_attorney?: string | null
  p_date_from?: string | null
  p_date_to?: string | null
  p_fuzzy?: boolean
  p_sort?: 'relevance' | 'newest' | 'oldest' | 'mark_asc' | 'mark_desc' | 'serial'
  p_limit?: number
  p_offset?: number
  /** Migration 0700 — only include when set (see lib/searchParams.toRpcArgs). */
  p_application_number?: string | null
  /** Migration 0700 — only include when set (see lib/searchParams.toRpcArgs). */
  p_registration_number?: string | null
}

export type FilterOptions = {
  gazettes: { gazette_number: string; publication_date: string | null; count: number }[]
  classes: { class: number; count: number }[]
  application_types: { value: string; count: number }[]
}

export type ImportJobRow = {
  id: string
  job_type: 'excel' | 'images'
  filename: string | null
  source_path: string | null
  gazette_number: string | null
  dry_run: boolean
  status: 'queued' | 'processing' | 'completed' | 'completed_with_warnings' | 'failed'
  started_at: string | null
  completed_at: string | null
  total_rows: number
  inserted_rows: number
  updated_rows: number
  skipped_rows: number
  failed_rows: number
  error_message: string | null
  summary: Record<string, unknown>
  created_by: string | null
  created_at: string
}

export type ImportJobItemRow = {
  id: number
  job_id: string
  item_ref: string | null
  status: 'inserted' | 'updated' | 'skipped' | 'failed' | 'unmatched' | 'ambiguous'
  message: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

export type RegistryStats = {
  trademarks: number
  applicants: number
  gazettes: number
  images: number
  unmatched_images: number
  needs_review: number
  latest_gazette: string | null
  latest_publication_date: string | null
}

// Minimal Database generic so supabase-js gives typed .from()/.rpc() calls.
export type Database = {
  public: {
    Tables: {
      trademarks: { Row: TrademarkRow; Insert: Partial<TrademarkRow>; Update: Partial<TrademarkRow>; Relationships: [] }
      trademark_images: { Row: TrademarkImageRow; Insert: Partial<TrademarkImageRow>; Update: Partial<TrademarkImageRow>; Relationships: [] }
      gazettes: { Row: GazetteRow; Insert: Partial<GazetteRow>; Update: Partial<GazetteRow>; Relationships: [] }
      import_jobs: { Row: ImportJobRow; Insert: Partial<ImportJobRow>; Update: Partial<ImportJobRow>; Relationships: [] }
      import_job_items: { Row: ImportJobItemRow; Insert: Partial<ImportJobItemRow>; Update: Partial<ImportJobItemRow>; Relationships: [] }
    }
    Views: {
      gazette_summaries: { Row: GazetteSummaryRow; Relationships: [] }
    }
    Functions: {
      search_trademarks: { Args: SearchTrademarksArgs; Returns: TrademarkSearchResult[] }
      similar_trademarks: { Args: { p_id: string; p_limit?: number }; Returns: TrademarkSearchResult[] }
      trademark_filter_options: { Args: Record<string, never>; Returns: FilterOptions }
      registry_stats: { Args: Record<string, never>; Returns: RegistryStats }
      recent_trademarks: { Args: { p_limit?: number }; Returns: TrademarkSearchResult[] }
      trademarks_by_class: { Args: Record<string, never>; Returns: { class: number; count: number }[] }
      is_admin: { Args: Record<string, never>; Returns: boolean }
      // Search by Image (migration 0500)
      search_trademarks_by_image: {
        Args: { p_embedding: number[]; p_version: number; p_limit?: number; p_min_similarity?: number }
        Returns: (TrademarkSearchResult & { similarity: number; matched_image_id: string })[]
      }
      image_search_status: { Args: { p_version?: number | null }; Returns: { available: boolean; descriptor_version: number | null; indexed_images: number; indexed_trademarks: number } }
      admin_image_index_status: { Args: { p_version: number }; Returns: { descriptor_version: number; matched_images: number; indexed: number; stale: number; missing: number; last_computed_at: string | null } }
      admin_images_missing_features: { Args: { p_version: number; p_limit?: number; p_offset?: number }; Returns: { id: string; trademark_id: string; storage_bucket: string; storage_path: string; serial_number: string | null; content_type: string | null; byte_size: number | null }[] }
      admin_upsert_image_features: { Args: { p_version: number; p_items: unknown[] }; Returns: { upserted: number; failed: number; results: unknown[] } }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
