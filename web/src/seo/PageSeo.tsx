import { useTranslation } from 'react-i18next'
import { Seo, type SeoProps } from './Seo'
import { breadcrumbList, webPage, type Crumb } from './jsonld'
import { localizePath, type SiteLocaleCode } from './locales'

type PageType = 'WebPage' | 'AboutPage' | 'ContactPage' | 'CollectionPage'

/**
 * Head metadata for a translated information page: title/description from the
 * `seo.<key>` locale section, a WebPage node and a breadcrumb trail
 * (Home › [parent ›] page) in structured data. Thin wrapper over <Seo>.
 */
export function PageSeo({
  seoKey,
  path,
  type = 'WebPage',
  crumbs = [],
  title,
  description,
  ...rest
}: {
  /** Key under `seo` in the locale files (e.g. 'services'). */
  seoKey: string
  /** Locale-less route path ('/services'). */
  path: string
  type?: PageType
  /** Breadcrumb trail below Home, ending with this page. Defaults to Home › this page (named by the title). */
  crumbs?: Crumb[]
  /** Override the locale title/description (e.g. a policy page). */
  title?: string
  description?: string
} & Pick<SeoProps, 'robots' | 'image' | 'canonical'>) {
  const { t, i18n } = useTranslation()
  const lng = (i18n.resolvedLanguage ?? 'en') as SiteLocaleCode
  const pageTitle = title ?? t(`seo.${seoKey}.title`)
  const pageDescription = description ?? t(`seo.${seoKey}.description`)
  const url = localizePath(path, rest.canonical === 'english' ? 'en' : lng)
  const trail: Crumb[] = [{ name: t('seo.breadcrumbHome'), path: localizePath('/', lng) }, ...(crumbs.length ? crumbs : [{ name: pageTitle.split(' | ')[0], path: url }])]
  return (
    <Seo
      title={pageTitle}
      description={pageDescription}
      path={path}
      jsonLd={[webPage({ type, lng, url, name: pageTitle, description: pageDescription }), breadcrumbList(trail)]}
      {...rest}
    />
  )
}
