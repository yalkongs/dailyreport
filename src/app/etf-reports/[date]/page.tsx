// /etf-reports/[date] — serves the pre-rendered ETF morning report HTML
// written by scripts/run-etf.ts to public/etf-reports/<date>.html.
//
// Based on the etfreport project's [date]/[type] page, simplified now
// that the evening edition is retired. Metadata pulls OG fields from
// the generated HTML so the Telegram link preview matches the page.

import * as fs from 'fs'
import * as path from 'path'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  REPORT_PREVIEW_IMAGE_HEIGHT,
  REPORT_PREVIEW_IMAGE_WIDTH,
  absoluteReportUrl,
  reportPreviewDescription,
  reportPreviewImageUrl,
  reportPreviewTitle,
  reportRouteUrl,
} from '../../../../lib/etf/report-preview'

interface Props {
  params: Promise<{ date: string }>
}

function validateDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound()
}

function generatedReportPath(date: string): string {
  return path.join(process.cwd(), 'public', 'etf-reports', `${date}.html`)
}

function readGeneratedReportHtml(date: string): string {
  const htmlPath = generatedReportPath(date)
  if (!fs.existsSync(htmlPath)) notFound()
  return fs.readFileSync(htmlPath, 'utf-8')
}

function extractMetaContent(html: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const propertyPattern = new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${escapedKey}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i')
  const contentFirstPattern = new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${escapedKey}["'][^>]*>`, 'i')
  const content = html.match(propertyPattern)?.[1] ?? html.match(contentFirstPattern)?.[1] ?? null
  return content ? decodeHtmlAttribute(content) : null
}

function extractDocumentTitle(html: string): string | null {
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null
  return title ? decodeHtmlAttribute(title) : null
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function publicBaseUrl(): string {
  return (
    process.env.ETF_PUBLIC_BASE_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    'http://localhost:3000'
  )
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params
  validateDate(date)

  const html = readGeneratedReportHtml(date)
  const baseUrl = publicBaseUrl()
  const fallbackHeadline = extractDocumentTitle(html) ?? `${date} ETF Today`
  const title = extractMetaContent(html, 'og:title') ?? reportPreviewTitle(fallbackHeadline)
  const description = extractMetaContent(html, 'og:description') ?? reportPreviewDescription(date)
  const rawImage = extractMetaContent(html, 'og:image') ?? reportPreviewImageUrl(date, baseUrl)
  const imageUrl = absoluteReportUrl(rawImage, baseUrl)
  const canonicalUrl = extractMetaContent(html, 'og:url') ?? reportRouteUrl(date, baseUrl)

  return {
    title,
    description,
    alternates: canonicalUrl ? { canonical: canonicalUrl } : undefined,
    openGraph: {
      title,
      description,
      type: 'article',
      url: canonicalUrl,
      images: [{
        url: imageUrl,
        width: REPORT_PREVIEW_IMAGE_WIDTH,
        height: REPORT_PREVIEW_IMAGE_HEIGHT,
        alt: title,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [imageUrl],
    },
  }
}

export default async function EtfReportPage({ params }: Props) {
  const { date } = await params
  validateDate(date)

  const html = readGeneratedReportHtml(date)
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i)
  const styleBlock = styleMatch ? `<style>${styleMatch[1]}</style>` : ''
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const bodyContent = bodyMatch ? bodyMatch[1] : html

  // Safe: HTML files are generated exclusively by lib/etf/renderer.ts
  // which applies escapeHtml() to all user-supplied content.
  return (
    <div dangerouslySetInnerHTML={{ __html: styleBlock + bodyContent }} />
  )
}

export async function generateStaticParams() {
  const dir = path.join(process.cwd(), 'public', 'etf-reports')
  if (!fs.existsSync(dir)) return []

  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.html'))
    .map(f => {
      const match = f.match(/^(\d{4}-\d{2}-\d{2})\.html$/)
      if (!match) return null
      return { date: match[1] }
    })
    .filter(Boolean)
}
