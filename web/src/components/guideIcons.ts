import { BookOpen, Briefcase, FileText, Gavel, Globe, Layers, RefreshCw, Scale, Search, ShieldCheck, Tag, type LucideIcon } from 'lucide-react'
import type { GuideIcon } from '@/content/guidesMeta'

/** Icon per guide (keys mirror `Guide['icon']`); shared by the hub, guide pages, the home "Learn" strip and article asides. */
export const GUIDE_ICON: Record<GuideIcon, LucideIcon> = { Search, FileText, ShieldCheck, Scale, Tag, Globe, RefreshCw, Layers, Briefcase, BookOpen, Gavel }
