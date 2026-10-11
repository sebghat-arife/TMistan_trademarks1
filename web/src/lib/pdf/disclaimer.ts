/**
 * Approved disclaimer for the PDF "Trademark Publication Report".
 *
 * This wording was supplied by the client and must be reproduced VERBATIM in
 * every generated report, placed before the record link. It is intentionally
 * kept out of the i18n catalogues so it is never machine-altered or translated:
 * the report prints this exact English text regardless of the UI language.
 */
export const REPORT_DISCLAIMER =
  'The information contained in this Trademark Publication Report is derived from the Official Gazette of Afghanistan, which is the official source for trademark publications in the country. While reasonable care is taken in compiling and presenting this information, this report does not constitute legal advice, a legal opinion, official confirmation, or any representation or guarantee regarding the validity, registration, ownership, enforceability, or current status of any trademark referenced herein. This report is provided free of charge for general informational purposes only. For a more comprehensive, accurate, and tailored assessment of a particular trademark, including its current status and potential conflicts with existing or pending marks, please contact us or request a customized trademark search and analysis report based on the most up-to-date information available.'

/** File name of the generated report, e.g. TMistan-Trademark-Report-1022-031.pdf */
export function reportFileName(serial: string): string {
  const safe = serial.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'record'
  return `TMistan-Trademark-Report-${safe}.pdf`
}
