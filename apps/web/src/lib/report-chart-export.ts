/**
 * Story 6.4 (Contract D.22-D.24) — browser-only pure SVG/PNG chart export helpers.
 *
 * Sanitizes filenames, clones framework-owned SVG, adds XML namespace,
 * opaque theme background and title/desc metadata before serializing.
 * PNG export rasterizes onto a 2x device-pixel canvas and downloads Blob.
 * All Object URLs are cleanly revoked; errors trigger actionable user feedback.
 */
import toast from 'react-hot-toast'
import type { CustomReportChartType } from '@/services/custom-report.service'

export interface PrepareSvgOptions {
  svgElement: SVGSVGElement
  title?: string | null
  description?: string | null
  backgroundColor?: string
  width?: number
  height?: number
}

export function sanitizeExportFilename(
  title: string | null | undefined,
  chartType: CustomReportChartType,
  extension: 'svg' | 'png',
): string {
  const baseTitle = (title ?? '').trim()
  let sanitized = baseTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!sanitized) {
    sanitized = 'report-chart'
  }

  const typeSlug = chartType.toLowerCase()
  return `${sanitized}-${typeSlug}.${extension}`
}

export function prepareSvgForExport(options: PrepareSvgOptions): string {
  const {
    svgElement,
    title,
    description,
    backgroundColor = '#ffffff',
    width: overrideWidth,
    height: overrideHeight,
  } = options

  const clone = svgElement.cloneNode(true) as SVGSVGElement

  const rect = svgElement.getBoundingClientRect()
  const width = overrideWidth ?? (rect.width > 0 ? rect.width : 800)
  const height = overrideHeight ?? (rect.height > 0 ? rect.height : 450)

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.setAttribute('width', `${width}`)
  clone.setAttribute('height', `${height}`)
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`)

  // Prepend title and desc if present
  if (description) {
    const descEl = document.createElementNS('http://www.w3.org/2000/svg', 'desc')
    descEl.textContent = description
    clone.insertBefore(descEl, clone.firstChild)
  }
  if (title) {
    const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    titleEl.textContent = title
    clone.insertBefore(titleEl, clone.firstChild)
  }

  // Prepend opaque background rectangle
  const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bgRect.setAttribute('width', '100%')
  bgRect.setAttribute('height', '100%')
  bgRect.setAttribute('fill', backgroundColor)
  clone.insertBefore(bgRect, clone.firstChild)

  const serializer = new XMLSerializer()
  return serializer.serializeToString(clone)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportChartAsSvg(
  svgElement: SVGSVGElement | null,
  title: string | null | undefined,
  chartType: CustomReportChartType,
): void {
  if (!svgElement) {
    toast.error('Chart SVG not found for export.')
    return
  }

  try {
    const svgString = prepareSvgForExport({
      svgElement,
      title,
      backgroundColor: '#ffffff',
    })
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const filename = sanitizeExportFilename(title, chartType, 'svg')
    downloadBlob(blob, filename)
    toast.success(`Exported ${filename}`)
  } catch (err) {
    console.error('Failed to export chart SVG:', err)
    toast.error('Failed to export SVG image.')
  }
}

export function exportChartAsPng(
  svgElement: SVGSVGElement | null,
  title: string | null | undefined,
  chartType: CustomReportChartType,
): Promise<void> {
  if (!svgElement) {
    toast.error('Chart element not found for export.')
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    try {
      const rect = svgElement.getBoundingClientRect()
      const width = rect.width > 0 ? rect.width : 800
      const height = rect.height > 0 ? rect.height : 450
      const scale = 2 // 2x high DPI

      const svgString = prepareSvgForExport({
        svgElement,
        title,
        backgroundColor: '#ffffff',
        width,
        height,
      })

      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const image = new Image()

      image.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = width * scale
          canvas.height = height * scale
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            URL.revokeObjectURL(url)
            toast.error('Canvas 2D context unavailable.')
            resolve()
            return
          }

          ctx.scale(scale, scale)
          ctx.drawImage(image, 0, 0, width, height)
          URL.revokeObjectURL(url)

          canvas.toBlob((pngBlob) => {
            if (!pngBlob) {
              toast.error('Failed to rasterize PNG image.')
              resolve()
              return
            }
            const filename = sanitizeExportFilename(title, chartType, 'png')
            downloadBlob(pngBlob, filename)
            toast.success(`Exported ${filename}`)
            resolve()
          }, 'image/png')
        } catch (err) {
          URL.revokeObjectURL(url)
          console.error('Failed to render canvas:', err)
          toast.error('Failed to generate PNG.')
          resolve()
        }
      }

      image.onerror = () => {
        URL.revokeObjectURL(url)
        toast.error('Failed to load chart SVG into canvas.')
        resolve()
      }

      image.src = url
    } catch (err) {
      console.error('Failed to export PNG:', err)
      toast.error('Failed to export PNG image.')
      resolve()
    }
  })
}
