import { supabase, storagePublicUrl } from '@/lib/supabase'
import type { TrademarkImageRow } from '@/lib/database.types'
import { unwrap } from './_shared'

/* ---------------------------------------------------------------------------
 * Image service — `trademark_images` rows + Supabase Storage URLs.
 *
 * Images are optional: an empty table simply yields `[]` and the UI shows a
 * neutral placeholder. Only rows with status = 'matched' are public (RLS
 * enforces the same rule server-side); this filter just keeps intent explicit.
 * ------------------------------------------------------------------------- */

export async function listTrademarkImages(trademarkId: string): Promise<TrademarkImageRow[]> {
  return unwrap(
    await supabase
      .from('trademark_images')
      .select('*')
      .eq('trademark_id', trademarkId)
      .eq('status', 'matched')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ) as TrademarkImageRow[]
}

/** Public URL of the full-size image (Supabase Storage public bucket). */
export const imageUrl = (img: Pick<TrademarkImageRow, 'storage_bucket' | 'storage_path'>) =>
  storagePublicUrl(img.storage_bucket, img.storage_path)

/** Public URL of the thumbnail, falling back to the full image. */
export const thumbnailUrl = (img: Pick<TrademarkImageRow, 'storage_bucket' | 'storage_path' | 'thumbnail_path'>) =>
  storagePublicUrl(img.storage_bucket, img.thumbnail_path) ?? imageUrl(img)
